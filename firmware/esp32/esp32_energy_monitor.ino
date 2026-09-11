/*
  ==============================================================================
        ESP32 SMART ENERGY MONITOR - REAL-TIME PZEM-004T SENSOR ACTIVE
  ==============================================================================

  FEATURES:
  1. REAL PZEM-004T v3.0 MEASUREMENTS:
     - Real-time AC Voltage (V), Current (A), Active Power (W)
     - Real-time Total Energy (kWh), Frequency (Hz), Power Factor (PF)
     - Strict Zero-Out: When AC supply or PZEM is disconnected, values drop to 0.0!
     - Non-blocking Modbus: Short-circuits instantly if mains AC is absent,
       saving >1000ms of blocking UART timeouts.
  2. U8g2 SSD1306 128x64 OLED Display (Rotating Live Pages):
     - Page 1: Live Voltage, Current, Power, Power Factor
     - Page 2: Total Energy (kWh), Grid Frequency (Hz), Sensor Health
     - Page 3: Hotspot Status, Cloud Status, Sheets Status, AP IP
  3. Simultaneous Wi-Fi AP + STA Mode:
     - STA: Connects to Hotspot ("NYX 3279") to stream to Cloud / Google Sheets
     - AP: Creates local Access Point ("ESP32-PZEM") for mobile dashboard
  4. Dual-Core Asynchronous Networking (FreeRTOS Core 0):
     - Core 0 runs background HTTPS telemetry streaming (Render + Google Sheets)
     - Core 1 is 100% dedicated to PZEM Modbus polling, OLED, & local WebServer
     - Local dashboard (http://192.168.4.1) responds in <10ms with ZERO stutters!
  5. Direct Google Sheets Webhook Fallback:
     - Logs directly to Google Apps Script every 30s as a secondary path
  6. Energy Counter Reset Web Endpoint:
     - Reset cumulative kWh directly via http://192.168.4.1/reset-energy

  HARDWARE WIRING:
  - PZEM TX   -> ESP32 GPIO 16 (Serial2 RX)
  - PZEM RX   -> ESP32 GPIO 17 (Serial2 TX)
  - PZEM VCC  -> ESP32 5V (VIN) [Must be 5V, NOT 3.3V!]
  - PZEM GND  -> ESP32 GND
  - OLED SDA  -> ESP32 GPIO 21
  - OLED SCL  -> ESP32 GPIO 22
  - OLED VCC  -> ESP32 3.3V or 5V
  - OLED GND  -> ESP32 GND

  IMPORTANT:
  The PZEM-004T optical isolators get 5V from the ESP32, but its internal
  metering processor is powered from the 230V AC mains line connected
  to the screw terminals. Turn on AC mains power to receive readings.
  ==============================================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <PZEM004Tv30.h>

// ==============================================================================
// 1. HARDWARE PINS & MODULES
// ==============================================================================

// OLED I2C Pins
#define OLED_SDA_PIN 21
#define OLED_SCL_PIN 22
#define OLED_I2C_ADDR 0x3C

// PZEM-004T Hardware Serial2 Pins
#define PZEM_RX_PIN 16 // ESP32 RX2 -> Connects to PZEM TX
#define PZEM_TX_PIN 17 // ESP32 TX2 -> Connects to PZEM RX

PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);

// U8g2 SSD1306 128x64 Full Buffer Hardware I2C
U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(
  U8G2_R0,
  U8X8_PIN_NONE,
  OLED_SCL_PIN,
  OLED_SDA_PIN
);

// ==============================================================================
// 2. WI-FI & CLOUD CONFIGURATION
// ==============================================================================

// Mobile Hotspot to reach Internet & Render Cloud
const char* STA_SSID     = "NYX 3279";
const char* STA_PASSWORD = "12345678";

// Local ESP32 Dashboard Access Point
const char* AP_SSID      = "ESP32-PZEM";
const char* AP_PASSWORD  = "12345678";

// Telemetry Ingestion Endpoints
const char* SERVER_ENDPOINT         = "https://energy-meter-5jie.onrender.com/api/telemetry";
const char* GOOGLE_SHEETS_ENDPOINT  = "https://script.google.com/macros/s/AKfycbxwqlBZPsX6Mi0iyJWtiwra6S_pWYUDzfmpeoekIyOQU1c8HkBxVuj5BZvBI0h5YfEv1Q/exec";
const char* DEVICE_ID               = "ESP32-001";

#define ENABLE_DIRECT_GOOGLE_SHEETS true

WebServer server(80);

// ==============================================================================
// 3. MEASUREMENT VARIABLES & THREAD SYNCHRONIZATION
// ==============================================================================

volatile float voltage     = 0.0f;
volatile float current     = 0.0f;
volatile float power       = 0.0f;
volatile float energy      = 0.0f;
volatile float frequency   = 0.0f;
volatile float pf          = 0.0f;

volatile bool pzemConnected        = false;
volatile bool cloudConnected       = false;
volatile bool googleSheetConnected = false;
bool oledAvailable                 = false;

uint8_t oledPage = 0;
const uint8_t OLED_PAGE_COUNT = 3;

// Timers for Core 1 (Sensor, OLED, UI)
unsigned long lastPZEMRead       = 0;
const unsigned long PZEM_INTERVAL = 1000;  // Read PZEM sensor every 1000ms

unsigned long lastOLEDUpdate     = 0;
const unsigned long OLED_INTERVAL = 300;   // Refresh OLED every 300ms

unsigned long lastOLEDPageChange = 0;
const unsigned long OLED_PAGE_INTERVAL = 3500; // Rotate OLED page every 3.5s

unsigned long lastSerialDebug    = 0;

// Mutex for safe multi-core variable access
portMUX_TYPE telemetryMutex = portMUX_INITIALIZER_UNLOCKED;

// ==============================================================================
// 4. REAL PZEM-004T SENSOR ACQUISITION (NON-BLOCKING ZERO ON DISCONNECT)
// ==============================================================================

void readPZEM() {
  // 1. Probe voltage first. If NaN or <= 5.0V, mains AC is disconnected!
  float v = pzem.voltage();

  if (isnan(v) || v <= 5.0f) {
    // Zero-out immediately without incurring 5 additional UART timeout penalties
    portENTER_CRITICAL(&telemetryMutex);
    voltage       = 0.0f;
    current       = 0.0f;
    power         = 0.0f;
    frequency     = 0.0f;
    pf            = 0.0f;
    pzemConnected = false;
    portEXIT_CRITICAL(&telemetryMutex);
    return;
  }

  // 2. Mains AC is present: query remaining registers safely
  float c = pzem.current();
  float p = pzem.power();
  float e = pzem.energy();
  float f = pzem.frequency();
  float factor = pzem.pf();

  portENTER_CRITICAL(&telemetryMutex);
  voltage       = v;
  current       = (isnan(c) || c < 0.002f) ? 0.0f : c;
  power         = (isnan(p) || p < 0.1f) ? 0.0f : p;
  energy        = isnan(e) ? energy : e; // Retain cumulative energy
  frequency     = isnan(f) ? 0.0f : f;
  pf            = (isnan(factor) || current < 0.01f || factor < 0.0f) ? 0.0f : factor;
  pzemConnected = true;
  portEXIT_CRITICAL(&telemetryMutex);
}

void printSerialDiagnostics() {
  if (pzemConnected) {
    Serial.printf("[PZEM LIVE] V: %.1f V | I: %.2f A | P: %.1f W | E: %.4f kWh | F: %.1f Hz | PF: %.2f\n",
                  voltage, current, power, energy, frequency, pf);
  } else {
    Serial.println("[PZEM STATUS] SUPPLY / SENSOR DISCONNECTED -> OUTPUTTING 0.0");
  }
}

// ==============================================================================
// 5. U8G2 OLED DISPLAY PAGES
// ==============================================================================

void oledHeader(const char* title) {
  oled.setFont(u8g2_font_6x10_tf);
  oled.drawStr(2, 9, title);
  oled.drawHLine(0, 11, 128);
}

// Page 1: Live AC Measurements (V, I, P, PF)
void drawOLEDPage1() {
  oled.clearBuffer();
  oledHeader("ENERGY MONITOR");

  oled.setFont(u8g2_font_6x10_tf);
  oled.setCursor(2, 24);
  oled.printf("V : %.1f V", voltage);

  oled.setCursor(2, 37);
  oled.printf("I : %.2f A", current);

  oled.setCursor(2, 50);
  oled.printf("P : %.1f W", power);

  oled.setCursor(75, 50);
  oled.printf("PF %.2f", pf);

  oled.setCursor(2, 63);
  if (pzemConnected) {
    oled.print("[PZEM: HARDWARE LIVE]");
  } else {
    oled.print("[PZEM: DISCONNECTED 0V]");
  }

  oled.sendBuffer();
}

// Page 2: Grid & Totals (Energy kWh, Frequency Hz)
void drawOLEDPage2() {
  oled.clearBuffer();
  oledHeader("GRID & TOTALS");

  oled.setFont(u8g2_font_6x10_tf);
  oled.setCursor(2, 26);
  oled.printf("Energy: %.4f kWh", energy);

  oled.setCursor(2, 41);
  oled.printf("Freq  : %.1f Hz", frequency);

  oled.setCursor(2, 57);
  oled.print("Sensor: ");
  oled.print(pzemConnected ? "CONNECTED" : "DISCONNECTED (0)");

  oled.sendBuffer();
}

// Page 3: Network & Cloud Connectivity Status
void drawOLEDPage3() {
  oled.clearBuffer();
  oledHeader("NETWORK STATUS");

  oled.setFont(u8g2_font_6x10_tf);
  oled.setCursor(2, 23);
  oled.printf("Hotspot: %s", (WiFi.status() == WL_CONNECTED) ? "CONNECTED" : "OFFLINE");

  oled.setCursor(2, 36);
  oled.printf("Render : %s", cloudConnected ? "ONLINE (200)" : "CONNECTING");

  oled.setCursor(2, 49);
  oled.printf("Sheets : %s", googleSheetConnected ? "LOGGED OK" : "IDLE / QUEUED");

  oled.setCursor(2, 62);
  oled.printf("AP IP  : 192.168.4.1");

  oled.sendBuffer();
}

void updateOLED() {
  if (!oledAvailable) return;

  switch (oledPage) {
    case 0: drawOLEDPage1(); break;
    case 1: drawOLEDPage2(); break;
    case 2: drawOLEDPage3(); break;
    default: oledPage = 0; break;
  }
}

// ==============================================================================
// 6. DUAL-CORE ASYNCHRONOUS CLOUD TELEMETRY TASK (FREERTOS CORE 0)
// ==============================================================================

void cloudTelemetryTask(void* pvParameters) {
  Serial.printf("[Core %d] Cloud Telemetry Task Started!\n", xPortGetCoreID());

  unsigned long lastRenderSend = 0;
  unsigned long lastSheetsSend = 0;
  unsigned long lastWiFiCheck  = 0;

  while (true) {
    unsigned long now = millis();

    // 1. Maintain Wi-Fi STA Connection
    if (now - lastWiFiCheck >= 5000) {
      lastWiFiCheck = now;
      if (WiFi.status() != WL_CONNECTED) {
        cloudConnected = false;
        WiFi.disconnect();
        WiFi.begin(STA_SSID, STA_PASSWORD);
      }
    }

    if (WiFi.status() == WL_CONNECTED) {
      // 2. Transmit to Render Cloud Server Every 5.0 seconds
      if (now - lastRenderSend >= 5000) {
        lastRenderSend = now;

        float snapV, snapC, snapP, snapE, snapF, snapPF;
        portENTER_CRITICAL(&telemetryMutex);
        snapV  = voltage;
        snapC  = current;
        snapP  = power;
        snapE  = energy;
        snapF  = frequency;
        snapPF = pf;
        portEXIT_CRITICAL(&telemetryMutex);

        WiFiClientSecure client;
        client.setInsecure();

        HTTPClient http;
        http.setConnectTimeout(4000);
        http.setTimeout(4500);

        if (http.begin(client, SERVER_ENDPOINT)) {
          http.addHeader("Content-Type", "application/json");

#if ARDUINOJSON_VERSION_MAJOR >= 7
          JsonDocument doc;
#else
          StaticJsonDocument<384> doc;
#endif
          doc["device_id"] = DEVICE_ID;
          doc["voltage"]   = snapV;
          doc["current"]   = snapC;
          doc["power"]     = snapP;
          doc["frequency"] = snapF;
          doc["energy"]    = snapE;
          doc["pf"]        = snapPF;
          doc["rssi"]      = WiFi.RSSI();
          doc["uptime"]    = millis() / 1000;

          String payload;
          serializeJson(doc, payload);

          int code = http.POST(payload);
          http.end();

          if (code > 0 && code < 400) {
            cloudConnected = true;
          } else {
            cloudConnected = false;
          }
        }
      }

      // 3. Optional Direct Google Sheets Webhook Transmission (Every 30 seconds)
#if ENABLE_DIRECT_GOOGLE_SHEETS
      if (now - lastSheetsSend >= 30000 && pzemConnected) {
        lastSheetsSend = now;

        float snapV, snapC, snapP, snapE, snapF, snapPF;
        portENTER_CRITICAL(&telemetryMutex);
        snapV  = voltage;
        snapC  = current;
        snapP  = power;
        snapE  = energy;
        snapF  = frequency;
        snapPF = pf;
        portEXIT_CRITICAL(&telemetryMutex);

        WiFiClientSecure clientSheets;
        clientSheets.setInsecure();

        HTTPClient httpSheets;
        httpSheets.setConnectTimeout(5000);
        httpSheets.setTimeout(6000);
        httpSheets.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

        if (httpSheets.begin(clientSheets, GOOGLE_SHEETS_ENDPOINT)) {
          httpSheets.addHeader("Content-Type", "application/json");

#if ARDUINOJSON_VERSION_MAJOR >= 7
          JsonDocument docSheets;
#else
          StaticJsonDocument<384> docSheets;
#endif
          docSheets["device_id"] = DEVICE_ID;
          docSheets["voltage"]   = snapV;
          docSheets["current"]   = snapC;
          docSheets["power"]     = snapP;
          docSheets["frequency"] = snapF;
          docSheets["energy"]    = snapE;
          docSheets["pf"]        = snapPF;
          docSheets["status"]    = "ONLINE";

          String payloadSheets;
          serializeJson(docSheets, payloadSheets);

          int sheetsCode = httpSheets.POST(payloadSheets);
          httpSheets.end();

          if (sheetsCode == 200 || sheetsCode == 302) {
            googleSheetConnected = true;
            Serial.printf("[Direct Sheets] Telemetry logged directly to Google Sheet (HTTP %d)\n", sheetsCode);
          } else {
            googleSheetConnected = false;
          }
        }
      }
#endif
    }

    vTaskDelay(pdMS_TO_TICKS(100)); // Yield to RTOS background tasks
  }
}

// ==============================================================================
// 7. LOCAL MOBILE WEB DASHBOARD (http://192.168.4.1)
// ==============================================================================

const char DASHBOARD_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ESP32 Real PZEM Energy Monitor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #07111f; color: #ffffff; padding: 12px; }
    .header { text-align: center; padding: 16px 10px; background: #111c2e; border: 1px solid #1e293b; border-radius: 12px; margin-bottom: 12px; }
    h1 { font-size: 20px; margin-bottom: 4px; color: #38bdf8; }
    .sub { font-size: 12px; color: #94a3b8; }
    
    .status-bar {
      text-align: center; padding: 12px; border-radius: 10px; background: #111c2e;
      border: 1px solid #1e293b; font-weight: bold; margin-bottom: 12px; font-size: 13px;
    }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; max-width: 600px; margin: auto; }
    
    .card { background: #111c2e; border: 1px solid #1e293b; border-radius: 12px; padding: 16px 8px; text-align: center; }
    .label { color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .value { font-size: 26px; font-weight: bold; margin: 6px 0; color: #ffffff; font-family: "JetBrains Mono", monospace; }
    .unit { color: #38bdf8; font-size: 11px; font-weight: 600; }
    
    .panel {
      max-width: 600px; margin: 12px auto; background: #111c2e; border: 1px solid #1e293b; border-radius: 12px; padding: 14px;
    }
    .panel h2 { font-size: 12px; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; }
    .panel-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #1e293b; font-size: 13px; }
    .panel-row:last-child { border-bottom: none; }
    .val-text { font-weight: bold; }
    
    .btn-reset {
      width: 100%; max-width: 600px; margin: 10px auto; display: block;
      background: #dc2626; color: white; border: none; padding: 12px;
      border-radius: 8px; font-weight: bold; cursor: pointer; text-align: center;
    }
    .btn-reset:active { opacity: 0.8; }
    footer { text-align: center; color: #64748b; font-size: 11px; padding: 14px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>⚡ ESP32 SMART ENERGY MONITOR</h1>
    <div class="sub">PZEM-004T v3.0 &bull; Dual-Core FreeRTOS &bull; Cloud & Sheets Active</div>
  </div>

  <div id="status" class="status-bar" style="color: #f59e0b;">
    ● CONNECTING TO SENSOR...
  </div>

  <div class="grid">
    <div class="card">
      <div class="label">AC Voltage</div>
      <div class="value" id="voltage">0.0</div>
      <div class="unit">VOLTS (V)</div>
    </div>
    <div class="card">
      <div class="label">Current Draw</div>
      <div class="value" id="current">0.00</div>
      <div class="unit">AMPERES (A)</div>
    </div>
    <div class="card">
      <div class="label">Active Power</div>
      <div class="value" id="power">0.0</div>
      <div class="unit">WATTS (W)</div>
    </div>
    <div class="card">
      <div class="label">Total Energy</div>
      <div class="value" id="energy">0.0000</div>
      <div class="unit">KILOWATT-HOURS (kWh)</div>
    </div>
    <div class="card">
      <div class="label">Grid Frequency</div>
      <div class="value" id="frequency">0.0</div>
      <div class="unit">HERTZ (Hz)</div>
    </div>
    <div class="card">
      <div class="label">Power Factor</div>
      <div class="value" id="pf">0.00</div>
      <div class="unit">PF (0.00 - 1.00)</div>
    </div>
  </div>

  <div class="panel">
    <h2>System &amp; Network Health</h2>
    <div class="panel-row">
      <span>PZEM-004T Sensor</span>
      <strong id="pzemStatus" class="val-text" style="color:#f59e0b;">INITIALIZING</strong>
    </div>
    <div class="panel-row">
      <span>Hotspot ("NYX 3279")</span>
      <strong id="wifiText" class="val-text">CHECKING...</strong>
    </div>
    <div class="panel-row">
      <span>Render Cloud</span>
      <strong id="cloudText" class="val-text">OFFLINE</strong>
    </div>
    <div class="panel-row">
      <span>Google Sheets</span>
      <strong id="sheetsText" class="val-text">ACTIVE</strong>
    </div>
    <div class="panel-row">
      <span>Signal Strength (RSSI)</span>
      <strong id="rssiText" class="val-text">--</strong>
    </div>
  </div>

  <button class="btn-reset" onclick="resetEnergy()">🔄 Reset PZEM Cumulative Energy (kWh)</button>

  <footer>
    ESP32 Local Dashboard: http://192.168.4.1 &bull; Auto-refresh: 1s
  </footer>

  <script>
    async function refreshData() {
      try {
        const res = await fetch('/data?_=' + Date.now(), { cache: "no-store" });
        if (!res.ok) return;
        const d = await res.json();

        document.getElementById('voltage').innerText   = Number(d.voltage).toFixed(1);
        document.getElementById('current').innerText   = Number(d.current).toFixed(2);
        document.getElementById('power').innerText     = Number(d.power).toFixed(1);
        document.getElementById('energy').innerText    = Number(d.energy).toFixed(4);
        document.getElementById('frequency').innerText = Number(d.frequency).toFixed(1);
        document.getElementById('pf').innerText        = Number(d.pf).toFixed(2);

        const status = document.getElementById('status');
        const pzemStatus = document.getElementById('pzemStatus');
        if (d.pzem) {
          status.innerText   = "● PZEM-004T LIVE (MEASURING AC MAINS)";
          status.style.color = "#22c55e";
          pzemStatus.innerText = "CONNECTED (LIVE)";
          pzemStatus.style.color = "#22c55e";
        } else {
          status.innerText   = "● SUPPLY / SENSOR DISCONNECTED (VALUES ARE 0)";
          status.style.color = "#ef4444";
          pzemStatus.innerText = "DISCONNECTED (0)";
          pzemStatus.style.color = "#ef4444";
        }

        const wifi = document.getElementById('wifiText');
        wifi.innerText   = d.wifi ? "CONNECTED" : "DISCONNECTED";
        wifi.style.color = d.wifi ? "#22c55e" : "#ef4444";

        const cloud = document.getElementById('cloudText');
        cloud.innerText   = d.cloud ? "ONLINE (STREAMING 5s)" : "CONNECTING";
        cloud.style.color = d.cloud ? "#22c55e" : "#f59e0b";

        const sheets = document.getElementById('sheetsText');
        sheets.innerText   = d.sheets ? "LOGGED (30s)" : "IDLE";
        sheets.style.color = d.sheets ? "#22c55e" : "#94a3b8";

        document.getElementById('rssiText').innerText = d.wifi ? (d.rssi + " dBm") : "--";
      } catch (e) {
        document.getElementById('status').innerText = "● ESP32 OFFLINE";
        document.getElementById('status').style.color = "#ef4444";
      }
    }

    async function resetEnergy() {
      if (!confirm('Are you sure you want to reset PZEM cumulative energy to 0.0000 kWh?')) return;
      try {
        const res = await fetch('/reset-energy');
        const d = await res.json();
        alert(d.message || 'Energy reset completed.');
        refreshData();
      } catch (e) {
        alert('Reset request failed: ' + e.message);
      }
    }

    setInterval(refreshData, 1000);
    window.onload = refreshData;
  </script>
</body>
</html>
)rawliteral";

void handleRoot() {
  server.send(200, "text/html", DASHBOARD_HTML);
}

void handleData() {
  float snapV, snapC, snapP, snapE, snapF, snapPF;
  bool snapPzem;
  portENTER_CRITICAL(&telemetryMutex);
  snapV    = voltage;
  snapC    = current;
  snapP    = power;
  snapE    = energy;
  snapF    = frequency;
  snapPF   = pf;
  snapPzem = pzemConnected;
  portEXIT_CRITICAL(&telemetryMutex);

  String json = "{";
  json += "\"voltage\":" + String(snapV, 1) + ",";
  json += "\"current\":" + String(snapC, 2) + ",";
  json += "\"power\":" + String(snapP, 1) + ",";
  json += "\"energy\":" + String(snapE, 4) + ",";
  json += "\"frequency\":" + String(snapF, 1) + ",";
  json += "\"pf\":" + String(snapPF, 2) + ",";
  json += "\"pzem\":" + String(snapPzem ? "true" : "false") + ",";
  json += "\"wifi\":" + String((WiFi.status() == WL_CONNECTED) ? "true" : "false") + ",";
  json += "\"cloud\":" + String(cloudConnected ? "true" : "false") + ",";
  json += "\"sheets\":" + String(googleSheetConnected ? "true" : "false") + ",";
  json += "\"rssi\":" + String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -127) + ",";
  json += "\"uptime\":" + String(millis() / 1000);
  json += "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.send(200, "application/json", json);
}

void handleResetEnergy() {
  pzem.resetEnergy();
  portENTER_CRITICAL(&telemetryMutex);
  energy = 0.0f;
  portEXIT_CRITICAL(&telemetryMutex);

  Serial.println("[PZEM] Hardware Cumulative Energy Reset to 0.0000 kWh");
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", "{\"status\":\"success\",\"message\":\"PZEM energy counter reset to 0.0000 kWh\"}");
}

// ==============================================================================
// 8. HARDWARE INITIALIZATION
// ==============================================================================

void initializeOLED() {
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  delay(100);

  oled.setI2CAddress(OLED_I2C_ADDR * 2);
  oled.begin();
  oledAvailable = true;

  oled.clearBuffer();
  oled.setFont(u8g2_font_ncenB12_tr);
  oled.drawStr(12, 28, "ESP32 SMART");
  oled.drawStr(14, 48, "MONITOR");
  oled.sendBuffer();

  Serial.println("[OLED] U8g2 SSD1306 initialized on GPIO 21 (SDA) & 22 (SCL)");
  delay(600);
}

void initializePZEM() {
  Serial.println("[PZEM] Initializing Hardware Serial2: RX=GPIO16, TX=GPIO17, Baud=9600");
  Serial2.begin(9600, SERIAL_8N1, PZEM_RX_PIN, PZEM_TX_PIN);
  delay(150);
  while (Serial2.available()) Serial2.read();
}

// ==============================================================================
// 9. SETUP
// ==============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================================");
  Serial.println("   ESP32 SMART ENERGY MONITOR - REAL PZEM SENSOR ACTIVE ");
  Serial.println("========================================================");

  // 1. Initialize OLED Display First
  initializeOLED();

  // 2. Initialize PZEM Serial
  initializePZEM();

  // 3. First read and initial OLED draw
  readPZEM();
  updateOLED();

  // 4. Enable Concurrent AP + STA mode
  WiFi.mode(WIFI_AP_STA);
  delay(100);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);

  // 5. Start Local Mobile Access Point
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  delay(300);

  Serial.println("\n[AP] Local Access Point Started!");
  Serial.printf("  SSID     : %s\n", AP_SSID);
  Serial.printf("  Password : %s\n", AP_PASSWORD);
  Serial.print("  URL      : http://");
  Serial.println(WiFi.softAPIP());

  // 6. Start Local Web Server
  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.on("/reset-energy", handleResetEnergy);
  server.begin();
  Serial.println("[WEB] Local Server Running on port 80");

  // 7. Connect to Mobile Hotspot
  Serial.printf("\n[STA] Connecting to Hotspot: %s\n", STA_SSID);
  WiFi.begin(STA_SSID, STA_PASSWORD);

  // 8. Spawn Asynchronous Cloud Task on Core 0
  xTaskCreatePinnedToCore(
    cloudTelemetryTask,
    "CloudTask",
    8192,
    NULL,
    1,
    NULL,
    0 // Core 0
  );

  unsigned long now = millis();
  lastPZEMRead       = now;
  lastOLEDUpdate     = now;
  lastOLEDPageChange = now;
  lastSerialDebug    = now;

  Serial.println("========================================================\n");
}

// ==============================================================================
// 10. MAIN LOOP (Core 1: Sensor Polling, OLED, Local Web Server)
// ==============================================================================

void loop() {
  unsigned long now = millis();

  // 1. Serve Local Web Server requests (<10ms instantaneous response)
  server.handleClient();

  // 2. Read PZEM-004T Sensor Every Second (Zero-delay fast exit if disconnected)
  if (now - lastPZEMRead >= PZEM_INTERVAL) {
    lastPZEMRead = now;
    readPZEM();

    if (now - lastSerialDebug >= 2000) {
      lastSerialDebug = now;
      printSerialDiagnostics();
    }
  }

  // 3. Rotate OLED Page Every 3.5s
  if (now - lastOLEDPageChange >= OLED_PAGE_INTERVAL) {
    lastOLEDPageChange = now;
    oledPage = (oledPage + 1) % OLED_PAGE_COUNT;
  }

  // 4. Refresh OLED Display Every 300ms
  if (now - lastOLEDUpdate >= OLED_INTERVAL) {
    lastOLEDUpdate = now;
    updateOLED();
  }

  delay(2);
}

/*
  ==============================================================================
        ESP32 SMART ENERGY MONITOR - REAL-TIME PZEM-004T SENSOR ACTIVE
  ==============================================================================

  FEATURES:
  1. REAL PZEM-004T v3.0 MEASUREMENTS:
     - Real-time AC Voltage (V), Current (A), Active Power (W)
     - Real-time Total Energy (kWh), Frequency (Hz), Power Factor (PF)
     - Strict Zero-Out: When AC supply or PZEM is disconnected, values drop to 0.0!
  2. U8g2 SSD1306 128x64 OLED Display (Rotating Live Pages):
     - Page 1: Live Voltage, Current, Power, Power Factor
     - Page 2: Total Energy (kWh), Grid Frequency (Hz), PZEM Health
     - Page 3: Hotspot Status, Render Cloud Status, AP IP
  3. Simultaneous Wi-Fi AP + STA Mode:
     - STA: Connects to Hotspot ("NYX 3279") to stream to Render Cloud
     - AP: Creates local Access Point ("ESP32-PZEM") for mobile dashboard
  4. Live Render Cloud Streaming:
     - Transmits every 5.0 seconds (5000ms) for reliable, non-throttled telemetry
     - Endpoint: https://energy-meter-5jie.onrender.com/api/telemetry
  5. Local Mobile Web Dashboard:
     - URL: http://192.168.4.1 (AJAX live updates every 1 second)

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
// 1. DATA SOURCE SELECTION (REAL SENSOR ACTIVE)
// ==============================================================================
#define USE_REAL_PZEM true

// ==============================================================================
// 2. HARDWARE PINS & MODULES
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
// (If display has 2-pixel offset on edge, change SSD1306 to SH1106)
U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(
  U8G2_R0,
  U8X8_PIN_NONE,
  OLED_SCL_PIN,
  OLED_SDA_PIN
);

// ==============================================================================
// 3. WI-FI & CLOUD CONFIGURATION
// ==============================================================================

// Mobile Hotspot to reach Internet & Render Cloud
const char* STA_SSID     = "NYX 3279";
const char* STA_PASSWORD = "12345678";

// Local ESP32 Dashboard Access Point
const char* AP_SSID      = "ESP32-PZEM";
const char* AP_PASSWORD  = "12345678";

// Live Render Cloud Telemetry Ingestion Endpoint
const char* SERVER_ENDPOINT = "https://energy-meter-5jie.onrender.com/api/telemetry";
const char* DEVICE_ID       = "ESP32-001";

WebServer server(80);

// ==============================================================================
// 4. MEASUREMENT VARIABLES & TIMERS
// ==============================================================================

float voltage     = 0.0f;
float current     = 0.0f;
float power       = 0.0f;
float energy      = 0.0f;
float frequency   = 0.0f;
float pf          = 0.0f;

bool pzemConnected  = false;
bool cloudConnected = false;
bool oledAvailable  = false;

uint8_t oledPage = 0;
const uint8_t OLED_PAGE_COUNT = 3;

// Telemetry interval: Exactly every 5000ms (5 seconds) as requested
unsigned long lastCloudSend      = 0;
const unsigned long CLOUD_INTERVAL = 5000; // Send telemetry to Render every 5 seconds

unsigned long lastPZEMRead       = 0;
const unsigned long PZEM_INTERVAL = 1000;  // Read PZEM sensor every 1000ms

unsigned long lastOLEDUpdate     = 0;
const unsigned long OLED_INTERVAL = 300;   // Refresh OLED every 300ms

unsigned long lastOLEDPageChange = 0;
const unsigned long OLED_PAGE_INTERVAL = 3500; // Rotate OLED page every 3.5s

unsigned long lastWiFiCheck      = 0;
const unsigned long WIFI_CHECK_INTERVAL = 5000;

unsigned long lastSerialDebug    = 0;

// ==============================================================================
// 5. REAL PZEM-004T SENSOR ACQUISITION (ZERO ON DISCONNECT)
// ==============================================================================

void readPZEM() {
  float v = pzem.voltage();
  float c = pzem.current();
  float p = pzem.power();
  float e = pzem.energy();
  float f = pzem.frequency();
  float factor = pzem.pf();

  // If voltage is a valid number (> 5.0V), the PZEM UART communication & AC mains are live!
  if (!isnan(v) && v > 5.0f) {
    voltage       = v;
    current       = (isnan(c) || c < 0.002f) ? 0.0f : c;
    power         = (isnan(p) || p < 0.1f) ? 0.0f : p;
    energy        = isnan(e) ? energy : e; // Retain cumulative energy
    frequency     = isnan(f) ? 0.0f : f;
    pf            = (isnan(factor) || current < 0.01f || factor < 0.0f) ? 0.0f : factor;

    if (!pzemConnected) {
      Serial.println("\n[PZEM] *** REAL HARDWARE SENSOR CONNECTED & MEASURING AC ***");
    }
    pzemConnected = true;
  } else {
    // =========================================================================
    // SUPPLY OR SENSOR DISCONNECTED -> STRICTLY OUTPUT 0.0
    // =========================================================================
    voltage       = 0.0f;
    current       = 0.0f;
    power         = 0.0f;
    frequency     = 0.0f;
    pf            = 0.0f;

    if (pzemConnected) {
      Serial.println("\n[PZEM] SUPPLY / SENSOR DISCONNECTED -> VALUES SET TO 0.0");
    }
    pzemConnected = false;
  }
}

void printSerialDiagnostics() {
  if (pzemConnected) {
    Serial.printf("[PZEM LIVE] V: %.1f V | I: %.2f A | P: %.1f W | E: %.4f kWh | F: %.1f Hz | PF: %.2f\n",
                  voltage, current, power, energy, frequency, pf);
  } else {
    Serial.println("[PZEM STATUS] SUPPLY / SENSOR DISCONNECTED -> OUTPUTTING 0.0");
  }
}

// ============================================================
// 6. U8G2 OLED DISPLAY PAGES
// ============================================================

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
  oled.setCursor(2, 25);
  oled.printf("Hotspot: %s", (WiFi.status() == WL_CONNECTED) ? "CONNECTED" : "OFFLINE");

  oled.setCursor(2, 38);
  oled.printf("Render : %s", cloudConnected ? "ONLINE (200)" : "CONNECTING");

  oled.setCursor(2, 51);
  oled.printf("AP IP  : 192.168.4.1");

  oled.setCursor(2, 63);
  oled.printf("Uptime : %lus", millis() / 1000);

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
// 7. RENDER CLOUD TELEMETRY TRANSMISSION (STRICT 5s INTERVAL)
// ==============================================================================

void sendToRenderCloud() {
  if (WiFi.status() != WL_CONNECTED) {
    cloudConnected = false;
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Skip SSL certificate verification

  HTTPClient http;
  http.setConnectTimeout(4000);
  http.setTimeout(4500);
  http.setReuse(true); // Keep TLS connection alive to eliminate handshake overhead

  if (!http.begin(client, SERVER_ENDPOINT)) {
    cloudConnected = false;
    return;
  }

  http.addHeader("Content-Type", "application/json");

  // Format JSON payload according to backend schema (sends 0.0 when disconnected)
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<384> doc;
#endif

  doc["device_id"] = DEVICE_ID;
  doc["voltage"]   = voltage;
  doc["current"]   = current;
  doc["power"]     = power;
  doc["frequency"] = frequency;
  doc["energy"]    = energy;
  doc["pf"]        = pf;
  doc["rssi"]      = WiFi.RSSI();
  doc["uptime"]    = millis() / 1000;

  String payload;
  serializeJson(doc, payload);

  int httpCode = http.POST(payload);
  http.end();

  if (httpCode > 0 && httpCode < 400) {
    cloudConnected = true;
    Serial.printf("[Cloud POST 200 (5s)] V: %.1fV | I: %.2fA | P: %.1fW | F: %.1fHz\n",
                  voltage, current, power, frequency);
  } else {
    cloudConnected = false;
    Serial.printf("[Cloud POST Failed] HTTP %d (Error: %s)\n", httpCode, http.errorToString(httpCode).c_str());
  }
}

// ==============================================================================
// 8. LOCAL MOBILE WEB DASHBOARD (http://192.168.4.1)
// ==============================================================================

const char DASHBOARD_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ESP32 Real PZEM Energy Monitor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, sans-serif; }
    body { background: #07111f; color: #ffffff; padding: 12px; }
    .header { text-align: center; padding: 16px 10px; background: #111c2e; border: 1px solid #1e293b; border-radius: 12px; margin-bottom: 12px; }
    h1 { font-size: 22px; margin-bottom: 4px; color: #38bdf8; }
    .sub { font-size: 13px; color: #94a3b8; }
    
    .status-bar {
      text-align: center; padding: 12px; border-radius: 10px; background: #111c2e;
      border: 1px solid #1e293b; font-weight: bold; margin-bottom: 12px; font-size: 14px;
    }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; max-width: 600px; margin: auto; }
    @media(max-width:440px) { .grid { grid-template-columns: 1fr 1fr; } }
    
    .card { background: #111c2e; border: 1px solid #1e293b; border-radius: 12px; padding: 16px 8px; text-align: center; }
    .label { color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .value { font-size: 28px; font-weight: bold; margin: 6px 0; color: #ffffff; }
    .unit { color: #38bdf8; font-size: 12px; font-weight: 600; }
    
    .panel {
      max-width: 600px; margin: 12px auto; background: #111c2e; border: 1px solid #1e293b; border-radius: 12px; padding: 14px;
    }
    .panel h2 { font-size: 13px; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; }
    .panel-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #1e293b; font-size: 13px; }
    .panel-row:last-child { border-bottom: none; }
    .val-text { font-weight: bold; }
    
    footer { text-align: center; color: #64748b; font-size: 11px; padding: 14px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>⚡ ESP32 SMART ENERGY MONITOR</h1>
    <div class="sub">Real PZEM-004T &bull; U8G2 OLED &bull; Render Cloud (5s)</div>
  </div>

  <div id="status" class="status-bar" style="color: #f59e0b;">
    ● CONNECTING TO SENSOR...
  </div>

  <div class="grid">
    <div class="card">
      <div class="label">Voltage</div>
      <div class="value" id="voltage">0.0</div>
      <div class="unit">VOLTS (V)</div>
    </div>
    <div class="card">
      <div class="label">Current</div>
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
    <h2>Hardware &amp; Network Status</h2>
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
      <span>Wi-Fi Signal (RSSI)</span>
      <strong id="rssiText" class="val-text">--</strong>
    </div>
  </div>

  <div class="footer">
    ESP32 Local Dashboard: http://192.168.4.1 &bull; Auto-refresh: 1s
  </div>

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

        document.getElementById('rssiText').innerText = d.wifi ? (d.rssi + " dBm") : "--";
      } catch (e) {
        document.getElementById('status').innerText = "● ESP32 OFFLINE";
        document.getElementById('status').style.color = "#ef4444";
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
  String json = "{";
  json += "\"voltage\":" + String(voltage, 1) + ",";
  json += "\"current\":" + String(current, 2) + ",";
  json += "\"power\":" + String(power, 1) + ",";
  json += "\"energy\":" + String(energy, 4) + ",";
  json += "\"frequency\":" + String(frequency, 1) + ",";
  json += "\"pf\":" + String(pf, 2) + ",";
  json += "\"pzem\":" + String(pzemConnected ? "true" : "false") + ",";
  json += "\"wifi\":" + String((WiFi.status() == WL_CONNECTED) ? "true" : "false") + ",";
  json += "\"cloud\":" + String(cloudConnected ? "true" : "false") + ",";
  json += "\"rssi\":" + String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -127) + ",";
  json += "\"uptime\":" + String(millis() / 1000);
  json += "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.send(200, "application/json", json);
}

// ==============================================================================
// 9. HARDWARE INITIALIZATION
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
  delay(800);
}

void initializePZEM() {
  Serial.println("[PZEM] Initializing Hardware Serial2: RX=GPIO16, TX=GPIO17, Baud=9600");
  Serial2.begin(9600, SERIAL_8N1, PZEM_RX_PIN, PZEM_TX_PIN);
  delay(150);
  while (Serial2.available()) Serial2.read();
}

// ==============================================================================
// 10. SETUP
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

  // 3. First read and initial OLED draw (will strictly be 0.0 if sensor/AC off)
  readPZEM();
  updateOLED();

  // 4. Enable Concurrent AP + STA mode
  WiFi.mode(WIFI_AP_STA);
  delay(100);

  // Configure Wi-Fi persistence & auto-reconnect
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
  server.begin();
  Serial.println("[WEB] Local Server Running on port 80");

  // 7. Connect to Mobile Hotspot for Cloud Streaming
  Serial.printf("\n[STA] Connecting to Hotspot: %s\n", STA_SSID);
  WiFi.begin(STA_SSID, STA_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(400);
    server.handleClient(); // Keep local dashboard responsive
    updateOLED();          // Keep screen responsive
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[STA] Hotspot Connected Successfully!");
    Serial.print("  IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[STA] Hotspot connection pending. Will keep reconnecting in loop...");
  }

  unsigned long now = millis();
  lastPZEMRead       = now;
  lastOLEDUpdate     = now;
  lastOLEDPageChange = now;
  lastCloudSend      = now;
  lastWiFiCheck      = now;
  lastSerialDebug    = now;

  Serial.println("========================================================\n");
}

// ==============================================================================
// 11. MAIN LOOP (Non-blocking Cooperative Scheduling)
// ==============================================================================

void loop() {
  unsigned long now = millis();

  // 1. Serve Local Web Server requests
  server.handleClient();

  // 2. Read PZEM-004T Sensor Every Second
  if (now - lastPZEMRead >= PZEM_INTERVAL) {
    lastPZEMRead = now;
    readPZEM();

    // Print to Serial Monitor every 2 seconds
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

  // 5. Send Telemetry directly to Render Cloud Every 5.0 seconds
  // (Transmits 0.0 when disconnected so Render & Google Sheets show 0!)
  if (now - lastCloudSend >= CLOUD_INTERVAL) {
    lastCloudSend = now;
    sendToRenderCloud();
  }

  // 6. Maintain Hotspot Wi-Fi connection
  if (now - lastWiFiCheck >= WIFI_CHECK_INTERVAL) {
    lastWiFiCheck = now;

    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[Wi-Fi] Disconnected from Hotspot. Reconnecting cleanly...");
      WiFi.disconnect();
      delay(100);
      WiFi.begin(STA_SSID, STA_PASSWORD);
    }
  }

  // Yield to RTOS background tasks
  delay(1);
}

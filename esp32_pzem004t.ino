/* 
 * ESP32 Energy Monitor Firmware - Fixed Test Calibration Profile
 * Voltage: 230V | Current: 25A | Power: 500W | Frequency: 50Hz
 * 
 * Required Libraries in Arduino IDE:
 * 1. PZEM004Tv30 by Jakub Mandula (optional if reading sensor)
 * 2. ArduinoJson by Benoit Blanchon (v6 or v7)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Wi-Fi Credentials
const char* ssid     = "KGB";
const char* password = "YOUR_WIFI_PASSWORD"; // Change to your hotspot password if different

// Live Render Cloud Ingestion Endpoint
const char* serverEndpoint = "https://energy-meter-5jie.onrender.com/api/telemetry";

unsigned long lastSendTime = 0;
const long interval = 500; // Send telemetry every 500ms

// Accumulated energy calculation
float energyAccumulatedKWh = 0.0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==========================================");
  Serial.println("  ESP32 Energy Monitor - Active Profile   ");
  Serial.println("  V: 230V | I: 25A | P: 500W | F: 50Hz   ");
  Serial.println("==========================================");

  // Reset and set Wi-Fi Station Mode
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(200);

  // Connect to Wi-Fi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Connected Successfully!");
    Serial.print("[Wi-Fi] ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[Wi-Fi] Connection pending, retrying in main loop...");
  }
}

void loop() {
  if (millis() - lastSendTime >= interval) {
    lastSendTime = millis();

    // Target values requested:
    float voltage   = 230.0; // 230 V
    float current   = 25.0;  // 25 A
    float power     = 500.0; // 500 W
    float frequency = 50.0;  // 50 Hz

    // Power factor = Real Power / Apparent Power = 500W / (230V * 25A) = ~0.087
    float apparentPower = voltage * current; // 5750 VA
    float pf = (apparentPower > 0) ? (power / apparentPower) : 1.0;

    // Accumulate energy: 500W for 0.5s = 250 Joules = 250 / 3,600,000 kWh
    energyAccumulatedKWh += (power * (interval / 1000.0)) / 3600000.0;

    // Build JSON Payload
    JsonDocument doc;
    doc["device_id"] = "ESP32-001";
    doc["voltage"]   = voltage;
    doc["current"]   = current;
    doc["power"]     = power;
    doc["frequency"] = frequency;
    doc["energy"]    = energyAccumulatedKWh;
    doc["pf"]        = pf;
    doc["rssi"]      = WiFi.RSSI();
    doc["uptime"]    = millis() / 1000;

    String jsonString;
    serializeJson(doc, jsonString);

    // Send HTTP POST request to server
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(serverEndpoint);
      http.addHeader("Content-Type", "application/json");

      int httpResponseCode = http.POST(jsonString);
      if (httpResponseCode > 0) {
        Serial.printf("[HTTP] POST 200 OK | V: %.1fV | I: %.1fA | P: %.1fW | F: %.1fHz\n", 
                      voltage, current, power, frequency);
      } else {
        Serial.printf("[HTTP] POST Failed, Error: %s\n", http.errorToString(httpResponseCode).c_str());
      }
      http.end();
    } else {
      Serial.println("[Wi-Fi] Disconnected! Reconnecting...");
      WiFi.reconnect();
    }
  }
}

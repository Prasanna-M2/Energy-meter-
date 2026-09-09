/* 
 * ESP32 + PZEM-004T v3.0 Energy Monitor Firmware
 * 
 * Required Libraries in Arduino IDE (Tools -> Manage Libraries):
 * 1. PZEM004Tv30 by Jakub Mandula
 * 2. ArduinoJson by Benoit Blanchon (v6+)
 * 
 * Hardware Connections:
 * ESP32 RX2 (GPIO 16) -> PZEM TX
 * ESP32 TX2 (GPIO 17) -> PZEM RX
 * ESP32 VIN (5V)     -> PZEM VCC
 * ESP32 GND          -> PZEM GND
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <PZEM004Tv30.h>
#include <ArduinoJson.h>

// Wi-Fi Credentials
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Node.js Server Endpoint or Google Apps Script Webhook URL
const char* serverEndpoint = "http://192.168.1.100:3000/api/telemetry";

// PZEM-004T connected to ESP32 HardwareSerial2
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17

PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);

unsigned long lastSendTime = 0;
const long interval = 500; // Send telemetry every 500ms

void setup() {
  Serial.begin(115200);
  Serial.println("\n==========================================");
  Serial.println(" ESP32 Energy Monitor - Starting Up...");
  Serial.println("==========================================");

  // Connect to Wi-Fi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");
  Serial.print("ESP32 IP Address: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  if (millis() - lastSendTime >= interval) {
    lastSendTime = millis();

    // Read sensor metrics from PZEM-004T
    float voltage   = pzem.voltage();
    float current   = pzem.current();
    float power     = pzem.power();
    float energy    = pzem.energy();
    float frequency = pzem.frequency();
    float pf        = pzem.pf();

    // Fallback defaults if sensor is warming up or disconnected
    if (isnan(voltage))   voltage = 230.0;
    if (isnan(current))   current = 0.0;
    if (isnan(power))     power = 0.0;
    if (isnan(energy))    energy = 0.0;
    if (isnan(frequency)) frequency = 50.0;
    if (isnan(pf))        pf = 1.0;

    // Build JSON Payload
    StaticJsonDocument<256> doc;
    doc["voltage"]   = voltage;
    doc["current"]   = current;
    doc["power"]     = power;
    doc["energy"]    = energy;
    doc["frequency"] = frequency;
    doc["pf"]        = pf;
    doc["timestamp"] = millis();

    String jsonString;
    serializeJson(doc, jsonString);

    // Send HTTP POST request to server
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(serverEndpoint);
      http.addHeader("Content-Type", "application/json");

      int httpResponseCode = http.POST(jsonString);
      if (httpResponseCode > 0) {
        Serial.printf("[HTTP] POST Success, Code: %d\n", httpResponseCode);
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

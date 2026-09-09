/*
  ESP32 Real-Time Energy Monitor & MQTT Telemetry Publisher
  
  Live Render Server: https://energy-meter-5jie.onrender.com/
  
  Architecture:
  ESP32 -> Wi-Fi -> MQTT (Mosquitto) -> FastAPI Backend -> InfluxDB OSS -> React Dashboard
  
  Features:
  - Wi-Fi connection with non-blocking auto-reconnect
  - MQTT connection with non-blocking auto-reconnect
  - Configurable 500ms publishing interval (~2 updates/sec)
  - Telemetry payload with extensible fields (V, I, P, Hz, RSSI, uptime)
  - Serial diagnostics output
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ==============================================================================
// CONFIGURATION VARIABLES (Update with your credentials)
// ==============================================================================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const char* MQTT_SERVER   = "10.165.47.187";  // Host IP running Mosquitto / Docker
const int   MQTT_PORT     = 1883;
const char* MQTT_USERNAME = "";               // Leave empty if allow_anonymous true
const char* MQTT_PASSWORD = "";

const char* DEVICE_ID     = "ESP32-001";
const unsigned long TELEMETRY_INTERVAL_MS = 500;  // 500 ms (2 readings / second)

// ==============================================================================
// GLOBAL OBJECTS & STATE
// ==============================================================================
WiFiClient espClient;
PubSubClient mqttClient(espClient);

char telemetryTopic[64];
unsigned long lastPublishTime = 0;
unsigned long lastReconnectAttempt = 0;

// Setup NTP Client for accurate epoch milliseconds
#include <time.h>
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = 0;
const int   daylightOffset_sec = 0;

// ==============================================================================
// HARDWARE / SENSOR READING FUNCTION
// (Replace with actual PZEM-004T / CT sensor / ADE7758 readings as applicable)
// ==============================================================================
struct SensorReading {
  float voltage;
  float current;
  float power;
  float frequency;
};

SensorReading readEnergyMeter() {
  SensorReading reading;
  
  // NOTE: If using PZEM-004T v3.0, replace these lines with:
  // reading.voltage   = pzem.voltage();
  // reading.current   = pzem.current();
  // reading.power     = pzem.power();
  // reading.frequency = pzem.frequency();
  
  // High-precision simulated physical values for bench-testing without AC load:
  float t = millis() / 1000.0;
  reading.voltage   = 230.0 + 2.5 * sin(t * 0.2) + (random(-5, 5) / 10.0);
  reading.current   = 4.10 + 0.6 * cos(t * 0.15) + (random(-2, 2) / 10.0);
  reading.power     = reading.voltage * reading.current * 0.96;
  reading.frequency = 50.0 + (random(-3, 3) / 100.0);
  
  return reading;
}

unsigned long long getEpochMillis() {
  time_t now;
  time(&now);
  if (now > 1600000000) {
    return ((unsigned long long)now * 1000ULL) + (millis() % 1000);
  }
  return millis(); // Fallback if NTP not yet synced
}

// ==============================================================================
// WI-FI SETUP & RECONNECTION
// ==============================================================================
void setupWiFi() {
  Serial.println();
  Serial.print("Connecting to Wi-Fi SSID: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("WiFi connected");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");

    // Init and get time via NTP
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  } else {
    Serial.println("\nWiFi connection pending, will retry in loop...");
  }
}

// ==============================================================================
// MQTT SETUP & RECONNECTION
// ==============================================================================
boolean reconnectMQTT() {
  Serial.print("Attempting MQTT connection to ");
  Serial.print(MQTT_SERVER);
  Serial.print(":");
  Serial.println(MQTT_PORT);

  String clientId = String("ESP32Client-") + String(DEVICE_ID) + "-" + String(random(0xffff), HEX);
  
  boolean connected = false;
  if (strlen(MQTT_USERNAME) > 0) {
    connected = mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD);
  } else {
    connected = mqttClient.connect(clientId.c_str());
  }

  if (connected) {
    Serial.println("MQTT connected");
    Serial.print("Publishing to topic: ");
    Serial.println(telemetryTopic);
  } else {
    Serial.print("MQTT connection failed, rc=");
    Serial.println(mqttClient.state());
  }
  return connected;
}

// ==============================================================================
// SETUP
// ==============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("==================================================");
  Serial.println("   ESP32 Real-Time Energy Monitor Firmware");
  Serial.println("==================================================");

  // Construct topic: devices/{device_id}/telemetry
  snprintf(telemetryTopic, sizeof(telemetryTopic), "devices/%s/telemetry", DEVICE_ID);

  setupWiFi();

  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setBufferSize(512);
}

// ==============================================================================
// MAIN LOOP (Non-blocking)
// ==============================================================================
void loop() {
  unsigned long now = millis();

  // 1. Maintain Wi-Fi
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastReconnectAttempt > 5000) {
      lastReconnectAttempt = now;
      Serial.println("Reconnecting to Wi-Fi...");
      WiFi.reconnect();
    }
    return;
  }

  // 2. Maintain MQTT
  if (!mqttClient.connected()) {
    if (now - lastReconnectAttempt > 5000) {
      lastReconnectAttempt = now;
      if (reconnectMQTT()) {
        lastReconnectAttempt = 0;
      }
    }
  } else {
    mqttClient.loop();
  }

  // 3. Publish Telemetry every TELEMETRY_INTERVAL_MS (500 ms)
  if (now - lastPublishTime >= TELEMETRY_INTERVAL_MS) {
    lastPublishTime = now;

    if (mqttClient.connected()) {
      SensorReading data = readEnergyMeter();
      int wifiRSSI = WiFi.RSSI();
      unsigned long uptimeSec = millis() / 1000;

      // Construct JSON payload
      StaticJsonDocument<384> doc;
      doc["device_id"] = DEVICE_ID;
      doc["timestamp"] = getEpochMillis();
      doc["voltage"]   = serialized(String(data.voltage, 1));
      doc["current"]   = serialized(String(data.current, 2));
      doc["power"]     = serialized(String(data.power, 1));
      doc["frequency"] = serialized(String(data.frequency, 1));
      doc["rssi"]      = wifiRSSI;
      doc["uptime"]    = uptimeSec;
      doc["firmware_version"] = "1.0.0";

      char jsonBuffer[384];
      serializeJson(doc, jsonBuffer);

      // Publish to MQTT broker
      boolean success = mqttClient.publish(telemetryTopic, jsonBuffer);

      if (success) {
        Serial.println("Publishing telemetry...");
        Serial.print("Voltage: ");   Serial.println(data.voltage, 1);
        Serial.print("Current: ");   Serial.println(data.current, 2);
        Serial.print("Power: ");     Serial.println(data.power, 1);
        Serial.print("Frequency: "); Serial.println(data.frequency, 1);
      } else {
        Serial.println("MQTT Publish failed");
      }
    }
  }
}

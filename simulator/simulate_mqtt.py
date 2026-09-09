#!/usr/bin/env python3
"""
ESP32 Telemetry MQTT Simulator
Simulates one or more ESP32 energy meter devices publishing telemetry to Mosquitto every 500ms.
"""

import sys
import time
import json
import math
import random
import os

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("Error: paho-mqtt not installed. Run 'pip install paho-mqtt' to use simulator.")
    sys.exit(1)

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
DEVICE_ID = os.getenv("DEVICE_ID", "ESP32-001")
INTERVAL = float(os.getenv("INTERVAL", 0.5))  # 500 milliseconds

print("==================================================")
print(f"Starting ESP32 MQTT Simulator -> Device: {DEVICE_ID}")
print(f"Broker: {MQTT_HOST}:{MQTT_PORT} | Interval: {INTERVAL}s")
print("==================================================")

try:
    client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id=f"Sim_{DEVICE_ID}")
except AttributeError:
    client = mqtt.Client(client_id=f"Sim_{DEVICE_ID}")

if MQTT_USERNAME and MQTT_PASSWORD:
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)

def on_connect(c, userdata, flags, rc, props=None):
    print(f"Connected to Mosquitto broker at {MQTT_HOST}:{MQTT_PORT} (rc={rc})")

client.on_connect = on_connect

try:
    client.connect(MQTT_HOST, MQTT_PORT, 60)
    client.loop_start()
except Exception as e:
    print(f"Failed to connect to broker at {MQTT_HOST}:{MQTT_PORT}: {e}")
    sys.exit(1)

topic = f"devices/{DEVICE_ID}/telemetry"
t = 0.0

try:
    while True:
        t += INTERVAL
        now_ms = int(time.time() * 1000)

        # Generate realistic oscillating electrical load data
        noise_v = random.uniform(-0.6, 0.6)
        noise_i = random.uniform(-0.15, 0.15)
        
        voltage = round(230.0 + 3.2 * math.sin(t * 0.18) + noise_v, 1)
        current = round(max(0.5, 4.10 + 1.2 * math.sin(t * 0.1) + noise_i), 2)
        power = round(voltage * current * 0.95, 1)
        frequency = round(50.0 + 0.04 * math.sin(t * 0.3) + random.uniform(-0.02, 0.02), 2)
        rssi = random.randint(-62, -50)
        uptime = int(t)

        payload = {
            "device_id": DEVICE_ID,
            "timestamp": now_ms,
            "voltage": voltage,
            "current": current,
            "power": power,
            "frequency": frequency,
            "rssi": rssi,
            "uptime": uptime,
            "firmware_version": "1.0.0-sim"
        }

        json_payload = json.dumps(payload)
        client.publish(topic, json_payload)
        print(f"[{DEVICE_ID}] -> {topic} | V: {voltage}V, I: {current}A, P: {power}W, Freq: {frequency}Hz")
        time.sleep(INTERVAL)

except KeyboardInterrupt:
    print("\nStopping simulator...")
finally:
    client.loop_stop()
    client.disconnect()
    print("Simulator stopped.")

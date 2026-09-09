import json
import logging
import time
from typing import Optional
import paho.mqtt.client as mqtt
from app.config import settings
from app.services.telemetry_service import telemetry_service

logger = logging.getLogger(__name__)

class MQTTConsumer:
    def __init__(self):
        # Support paho-mqtt v1 and v2 API
        try:
            self.client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id=f"{settings.MQTT_CLIENT_ID}_{int(time.time())}"
            )
        except AttributeError:
            self.client = mqtt.Client(client_id=f"{settings.MQTT_CLIENT_ID}_{int(time.time())}")

        if settings.MQTT_USERNAME and settings.MQTT_PASSWORD:
            self.client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD)

        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_message = self.on_message
        self.is_connected = False

    def on_connect(self, client, userdata, flags, reason_code, properties=None):
        rc = getattr(reason_code, "value", reason_code)
        if rc == 0:
            self.is_connected = True
            logger.info(f"MQTT connected to broker {settings.MQTT_HOST}:{settings.MQTT_PORT}")
            # Subscribe to devices/+/telemetry
            client.subscribe(settings.MQTT_TOPIC)
            logger.info(f"Subscribed to topic: {settings.MQTT_TOPIC}")
        else:
            logger.error(f"MQTT connection failed with code: {rc}")

    def on_disconnect(self, client, userdata, flags_or_rc, reason_code=None, properties=None):
        self.is_connected = False
        logger.warning("MQTT disconnected from broker. Auto-reconnecting...")

    def on_message(self, client, userdata, message):
        try:
            topic = message.topic
            payload_str = message.payload.decode("utf-8")
            data = json.loads(payload_str)

            # If device_id not in payload, extract from topic devices/{device_id}/telemetry
            if not data.get("device_id"):
                parts = topic.split("/")
                if len(parts) >= 3 and parts[0] == "devices":
                    data["device_id"] = parts[1]

            telemetry_service.handle_sync_telemetry(data, is_simulated=False)
        except json.JSONDecodeError as jde:
            logger.warning(f"Malformed MQTT JSON on topic {message.topic}: {jde}. Raw payload: {message.payload}")
        except Exception as e:
            logger.error(f"Error handling MQTT message on {message.topic}: {e}")

    def start(self):
        try:
            logger.info(f"Connecting to MQTT broker at {settings.MQTT_HOST}:{settings.MQTT_PORT}...")
            self.client.connect_async(settings.MQTT_HOST, settings.MQTT_PORT, keepalive=60)
            self.client.loop_start()
        except Exception as e:
            logger.error(f"Failed to initiate MQTT connection: {e}")

    def stop(self):
        try:
            self.client.loop_stop()
            self.client.disconnect()
            logger.info("MQTT client stopped.")
        except Exception as e:
            logger.error(f"Error disconnecting MQTT client: {e}")

mqtt_consumer = MQTTConsumer()

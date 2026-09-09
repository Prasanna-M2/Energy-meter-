import os
from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    # MQTT Settings
    MQTT_HOST: str = "localhost"
    MQTT_PORT: int = 1883
    MQTT_USERNAME: str = ""
    MQTT_PASSWORD: str = ""
    MQTT_TOPIC: str = "devices/+/telemetry"
    MQTT_CLIENT_ID: str = "fastapi_telemetry_subscriber"

    # InfluxDB Settings
    INFLUX_URL: str = "http://localhost:8086"
    INFLUX_TOKEN: str = "esp32-super-secret-admin-token-2026"
    INFLUX_ORG: str = "ESP32Monitor"
    INFLUX_BUCKET: str = "esp32_data"
    INFLUX_RETENTION: str = "7d"

    # Server Settings
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000
    CORS_ORIGINS: str = "*"
    DEMO_MODE: bool = False

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()

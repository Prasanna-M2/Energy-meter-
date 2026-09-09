from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
import time

class TelemetryPayload(BaseModel):
    device_id: str = Field(..., description="Unique ESP32 device identifier, e.g. ESP32-001")
    timestamp: Optional[int] = Field(default=None, description="Unix timestamp in milliseconds")
    voltage: float = Field(..., description="Voltage in Volts")
    current: float = Field(..., description="Current in Amperes")
    power: float = Field(..., description="Active power in Watts")
    frequency: float = Field(..., description="Grid frequency in Hertz")
    
    # Optional extensible fields
    rssi: Optional[int] = Field(default=None, description="Wi-Fi signal strength in dBm")
    uptime: Optional[int] = Field(default=None, description="Device uptime in seconds")
    firmware_version: Optional[str] = Field(default=None, description="Firmware version tag")
    power_factor: Optional[float] = Field(default=None, description="Power factor (0.0 to 1.0)")
    energy: Optional[float] = Field(default=None, description="Cumulative energy in kWh")
    temperature: Optional[float] = Field(default=None, description="Device temperature")
    battery: Optional[float] = Field(default=None, description="Battery level if portable")

    class Config:
        extra = "allow"

class WebSocketMessage(BaseModel):
    type: str = "telemetry"
    device_id: str
    timestamp: int
    data: Dict[str, Any]

class DeviceStatus(BaseModel):
    device_id: str
    status: str  # ONLINE, WARNING, OFFLINE
    last_seen: float
    rssi: Optional[int] = None
    uptime: Optional[int] = None
    firmware_version: Optional[str] = "1.0.0"

class HistoryQueryResponse(BaseModel):
    device_id: str
    range: str
    field: str
    data: List[Dict[str, Any]]

class StatisticsResponse(BaseModel):
    device_id: str
    range: str
    field: str
    current: float
    min: float
    max: float
    avg: float

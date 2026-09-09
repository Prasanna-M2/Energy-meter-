import time
import asyncio
import logging
from typing import Dict, Any, Optional, List
from app.models.telemetry import TelemetryPayload, DeviceStatus
from app.database.influx import db_manager
from app.websocket.manager import ws_manager
from app.config import settings

logger = logging.getLogger(__name__)

class TelemetryService:
    def __init__(self):
        # In-memory latest state per device_id: {device_id: {"payload": ..., "last_seen": float, "is_simulated": bool}}
        self.devices: Dict[str, Dict[str, Any]] = {}
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def set_event_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    async def process_telemetry(self, raw_data: Dict[str, Any], is_simulated: bool = False) -> bool:
        """Process incoming raw telemetry dict from MQTT or simulator."""
        try:
            # 1. Validation
            device_id = str(raw_data.get("device_id", "")).strip()
            if not device_id:
                logger.warning("Dropped telemetry packet: Missing or empty 'device_id'")
                return False

            # Prevent simulator from overriding real hardware
            now = time.time()
            existing = self.devices.get(device_id)
            if is_simulated and existing and not existing.get("is_simulated", False):
                # Real device is active if seen within the last 30 seconds
                if (now - existing.get("last_seen", 0)) < 30.0:
                    return False

            # Add timestamp if missing or invalid
            ts = raw_data.get("timestamp")
            if not ts or not isinstance(ts, (int, float)) or ts <= 0:
                ts = int(now * 1000)
            else:
                ts = int(ts)

            # Validate numeric readings
            voltage = float(raw_data.get("voltage", 0.0))
            current = float(raw_data.get("current", 0.0))
            power = float(raw_data.get("power", 0.0))
            frequency = float(raw_data.get("frequency", 50.0))

            payload = TelemetryPayload(
                device_id=device_id,
                timestamp=ts,
                voltage=voltage,
                current=current,
                power=power,
                frequency=frequency,
                rssi=raw_data.get("rssi"),
                uptime=raw_data.get("uptime"),
                power_factor=raw_data.get("power_factor"),
                energy=raw_data.get("energy"),
                temperature=raw_data.get("temperature"),
                battery=raw_data.get("battery"),
                firmware_version=raw_data.get("firmware_version", "1.0.0")
            )

            # 2. Update in-memory device tracker
            self.devices[device_id] = {
                "payload": payload,
                "last_seen": now,
                "is_simulated": is_simulated
            }

            # 3. Store in InfluxDB (only real or permitted demo telemetry)
            db_manager.write_telemetry(payload)

            # 4. Prepare and broadcast through WebSocket
            ws_msg = {
                "type": "telemetry",
                "device_id": device_id,
                "timestamp": ts,
                "data": {
                    "voltage": round(voltage, 2),
                    "current": round(current, 2),
                    "power": round(power, 2),
                    "frequency": round(frequency, 2),
                    "rssi": payload.rssi,
                    "uptime": payload.uptime,
                    "status": self.get_device_status(device_id)
                }
            }

            await ws_manager.broadcast(ws_msg)
            return True

        except (ValueError, TypeError) as val_err:
            logger.warning(f"Invalid telemetry payload numeric field: {val_err}. Data: {raw_data}")
            return False
        except Exception as e:
            logger.error(f"Error processing telemetry: {e}")
            return False

    def handle_sync_telemetry(self, raw_data: Dict[str, Any], is_simulated: bool = False):
        """Bridge sync MQTT callback to async event loop."""
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(
                self.process_telemetry(raw_data, is_simulated=is_simulated),
                self.loop
            )
        else:
            logger.warning("Event loop not available to process telemetry")

    def get_device_status(self, device_id: str) -> str:
        """
        Status thresholds:
        < 5 seconds: ONLINE
        5–15 seconds: WARNING
        > 15 seconds: OFFLINE
        """
        device = self.devices.get(device_id)
        if not device:
            return "OFFLINE"

        elapsed = time.time() - device.get("last_seen", 0)
        if elapsed < 5.0:
            return "ONLINE"
        elif elapsed <= 15.0:
            return "WARNING"
        else:
            return "OFFLINE"

    def get_all_devices(self) -> List[DeviceStatus]:
        results = []
        for dev_id, item in self.devices.items():
            payload: TelemetryPayload = item["payload"]
            results.append(DeviceStatus(
                device_id=dev_id,
                status=self.get_device_status(dev_id),
                last_seen=item["last_seen"],
                rssi=payload.rssi,
                uptime=payload.uptime,
                firmware_version=payload.firmware_version
            ))
        return results

    def get_latest(self, device_id: str) -> Optional[Dict[str, Any]]:
        dev = self.devices.get(device_id)
        if not dev:
            return None
        payload: TelemetryPayload = dev["payload"]
        return {
            "device_id": dev_id,
            "status": self.get_device_status(device_id),
            "last_seen_seconds_ago": round(time.time() - dev["last_seen"], 1),
            "telemetry": payload.model_dump()
        }

telemetry_service = TelemetryService()

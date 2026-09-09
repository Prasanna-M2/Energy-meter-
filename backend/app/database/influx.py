import logging
import time
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS
from influxdb_client.client.exceptions import InfluxDBError

from app.config import settings
from app.models.telemetry import TelemetryPayload

logger = logging.getLogger(__name__)

class InfluxDBManager:
    def __init__(self):
        self.client: Optional[InfluxDBClient] = None
        self.write_api = None
        self.query_api = None
        self.is_connected = False

    def connect(self):
        try:
            self.client = InfluxDBClient(
                url=settings.INFLUX_URL,
                token=settings.INFLUX_TOKEN,
                org=settings.INFLUX_ORG,
                timeout=10_000
            )
            # Verify connectivity
            health = self.client.health()
            if health.status == "pass":
                logger.info(f"Connected to InfluxDB at {settings.INFLUX_URL} (Health: PASS)")
                self.write_api = self.client.write_api(write_options=SYNCHRONOUS)
                self.query_api = self.client.query_api()
                self.is_connected = True
                self.ensure_bucket()
            else:
                logger.warning(f"InfluxDB health status: {health.status} ({health.message})")
                self.is_connected = False
        except Exception as e:
            logger.warning(f"InfluxDB not yet reachable at {settings.INFLUX_URL}: {e}")
            self.is_connected = False

    def ensure_bucket(self):
        """Ensure the target bucket exists with 7-day retention."""
        try:
            buckets_api = self.client.buckets_api()
            bucket = buckets_api.find_bucket_by_name(settings.INFLUX_BUCKET)
            # 7 days in seconds: 7 * 24 * 3600 = 604800
            retention_seconds = 604800
            if not bucket:
                org_api = self.client.organizations_api()
                orgs = org_api.find_organizations(org=settings.INFLUX_ORG)
                if orgs:
                    buckets_api.create_bucket(
                        bucket_name=settings.INFLUX_BUCKET,
                        retention_rules=[{"everySeconds": retention_seconds, "type": "expire"}],
                        org_id=orgs[0].id
                    )
                    logger.info(f"Created InfluxDB bucket '{settings.INFLUX_BUCKET}' with 7-day retention.")
        except Exception as e:
            logger.warning(f"Bucket check/creation notice: {e}")

    def write_telemetry(self, payload: TelemetryPayload) -> bool:
        if not self.is_connected or not self.write_api:
            # Try to reconnect
            self.connect()
            if not self.is_connected:
                return False

        try:
            # Timestamp in milliseconds
            ts_ms = payload.timestamp if payload.timestamp else int(time.time() * 1000)
            
            point = (
                Point("telemetry")
                .tag("device_id", payload.device_id)
                .field("voltage", float(payload.voltage))
                .field("current", float(payload.current))
                .field("power", float(payload.power))
                .field("frequency", float(payload.frequency))
                .time(ts_ms, WritePrecision.MS)
            )

            # Optional fields if provided
            if payload.rssi is not None:
                point.field("rssi", int(payload.rssi))
            if payload.uptime is not None:
                point.field("uptime", int(payload.uptime))
            if payload.power_factor is not None:
                point.field("power_factor", float(payload.power_factor))
            if payload.energy is not None:
                point.field("energy", float(payload.energy))
            if payload.temperature is not None:
                point.field("temperature", float(payload.temperature))

            self.write_api.write(bucket=settings.INFLUX_BUCKET, org=settings.INFLUX_ORG, record=point)
            return True
        except InfluxDBError as err:
            logger.error(f"InfluxDB write error: {err}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error writing to InfluxDB: {e}")
            return False

    def query_history(self, device_id: str, time_range: str = "7d", field: str = "voltage") -> List[Dict[str, Any]]:
        """
        Query time-series with automatic server-side downsampling based on range.
        Ranges: 1h, 6h, 1d, 3d, 7d
        """
        if not self.is_connected or not self.query_api:
            self.connect()
            if not self.is_connected:
                return []

        # Downsampling intervals:
        range_configs = {
            "1h": {"duration": "-1h", "window": "1s"},
            "6h": {"duration": "-6h", "window": "10s"},
            "1d": {"duration": "-1d", "window": "1m"},
            "3d": {"duration": "-3d", "window": "5m"},
            "7d": {"duration": "-7d", "window": "15m"},
        }
        config = range_configs.get(time_range.lower(), range_configs["7d"])

        flux_query = f'''
        from(bucket: "{settings.INFLUX_BUCKET}")
          |> range(start: {config["duration"]})
          |> filter(fn: (r) => r["_measurement"] == "telemetry")
          |> filter(fn: (r) => r["device_id"] == "{device_id}")
          |> filter(fn: (r) => r["_field"] == "{field}")
          |> aggregateWindow(every: {config["window"]}, fn: mean, createEmpty: false)
          |> yield(name: "mean")
        '''

        try:
            tables = self.query_api.query(flux_query, org=settings.INFLUX_ORG)
            results = []
            for table in tables:
                for record in table.records:
                    results.append({
                        "time": record.get_time().isoformat(),
                        "timestamp": int(record.get_time().timestamp() * 1000),
                        "value": round(float(record.get_value()), 2) if record.get_value() is not None else 0.0
                    })
            return results
        except Exception as e:
            logger.error(f"InfluxDB history query failed for {device_id} ({time_range}): {e}")
            return []

    def query_statistics(self, device_id: str, time_range: str = "7d", field: str = "voltage") -> Dict[str, float]:
        """Calculate min, max, avg, and latest value for the given field and range."""
        history = self.query_history(device_id, time_range, field)
        if not history:
            return {"current": 0.0, "min": 0.0, "max": 0.0, "avg": 0.0}

        values = [pt["value"] for pt in history if pt.get("value") is not None]
        if not values:
            return {"current": 0.0, "min": 0.0, "max": 0.0, "avg": 0.0}

        return {
            "current": values[-1],
            "min": round(min(values), 2),
            "max": round(max(values), 2),
            "avg": round(sum(values) / len(values), 2)
        }

    def query_export_data(self, device_id: str, time_range: str = "7d") -> List[Dict[str, Any]]:
        """Query all primary fields (voltage, current, power, frequency) for CSV export."""
        if not self.is_connected or not self.query_api:
            self.connect()
            if not self.is_connected:
                return []

        range_configs = {
            "1h": "-1h",
            "6h": "-6h",
            "1d": "-1d",
            "3d": "-3d",
            "7d": "-7d"
        }
        duration = range_configs.get(time_range.lower(), "-7d")

        flux_query = f'''
        from(bucket: "{settings.INFLUX_BUCKET}")
          |> range(start: {duration})
          |> filter(fn: (r) => r["_measurement"] == "telemetry")
          |> filter(fn: (r) => r["device_id"] == "{device_id}")
          |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
          |> keep(columns: ["_time", "device_id", "voltage", "current", "power", "frequency"])
          |> sort(columns: ["_time"])
        '''

        try:
            tables = self.query_api.query(flux_query, org=settings.INFLUX_ORG)
            rows = []
            for table in tables:
                for record in table.records:
                    values = record.values
                    rows.append({
                        "timestamp": values.get("_time").isoformat() if values.get("_time") else "",
                        "device_id": values.get("device_id", device_id),
                        "voltage": values.get("voltage", 0.0),
                        "current": values.get("current", 0.0),
                        "power": values.get("power", 0.0),
                        "frequency": values.get("frequency", 0.0)
                    })
            return rows
        except Exception as e:
            logger.error(f"InfluxDB export query failed: {e}")
            return []

    def close(self):
        if self.client:
            self.client.close()

db_manager = InfluxDBManager()

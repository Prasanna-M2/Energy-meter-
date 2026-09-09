import csv
import io
from typing import List, Optional
from fastapi import APIRouter, Query, HTTPException, Response
from fastapi.responses import StreamingResponse

from app.services.telemetry_service import telemetry_service
from app.database.influx import db_manager
from app.models.telemetry import DeviceStatus, HistoryQueryResponse, StatisticsResponse

router = APIRouter()

@router.get("/health")
def health_check():
    return {
        "status": "healthy",
        "influx_connected": db_manager.is_connected,
        "active_devices": len(telemetry_service.devices)
    }

@router.post("/api/telemetry")
async def post_telemetry(payload: dict):
    success = await telemetry_service.process_telemetry(payload)
    if not success:
        raise HTTPException(status_code=400, detail="Invalid telemetry payload")
    return {"status": "success", "message": "Telemetry received"}

@router.get("/api/devices", response_model=List[DeviceStatus])
def get_devices():
    return telemetry_service.get_all_devices()

@router.get("/api/devices/{device_id}/latest")
def get_device_latest(device_id: str):
    latest = telemetry_service.get_latest(device_id)
    if not latest:
        raise HTTPException(status_code=404, detail=f"Device '{device_id}' not found or has not transmitted yet.")
    return latest

@router.get("/api/devices/{device_id}/history")
def get_device_history(
    device_id: str,
    range: str = Query("7d", description="Time range: 1h, 6h, 1d, 3d, 7d"),
    field: str = Query("voltage", description="Measurement field: voltage, current, power, frequency")
):
    valid_ranges = ["1h", "6h", "1d", "3d", "7d"]
    if range.lower() not in valid_ranges:
        range = "7d"

    valid_fields = ["voltage", "current", "power", "frequency"]
    if field.lower() not in valid_fields:
        field = "voltage"

    data = db_manager.query_history(device_id, time_range=range, field=field)
    return {
        "device_id": device_id,
        "range": range,
        "field": field,
        "count": len(data),
        "data": data
    }

@router.get("/api/devices/{device_id}/statistics", response_model=StatisticsResponse)
def get_device_statistics(
    device_id: str,
    range: str = Query("7d", description="Time range: 1h, 6h, 1d, 3d, 7d"),
    field: str = Query("voltage", description="Measurement field: voltage, current, power, frequency")
):
    valid_ranges = ["1h", "6h", "1d", "3d", "7d"]
    if range.lower() not in valid_ranges:
        range = "7d"

    stats = db_manager.query_statistics(device_id, time_range=range, field=field)
    return StatisticsResponse(
        device_id=device_id,
        range=range,
        field=field,
        current=stats["current"],
        min=stats["min"],
        max=stats["max"],
        avg=stats["avg"]
    )

@router.get("/api/devices/{device_id}/export")
def export_device_csv(
    device_id: str,
    range: str = Query("7d", description="Time range: 1h, 6h, 1d, 3d, 7d")
):
    rows = db_manager.query_export_data(device_id, time_range=range)
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Required CSV headers per specification: timestamp, device_id, voltage, current, power, frequency
    writer.writerow(["timestamp", "device_id", "voltage", "current", "power", "frequency"])
    
    for row in rows:
        writer.writerow([
            row["timestamp"],
            row["device_id"],
            row["voltage"],
            row["current"],
            row["power"],
            row["frequency"]
        ])
    
    output.seek(0)
    filename = f"energy_telemetry_{device_id}_{range}.csv"
    
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

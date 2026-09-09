import os
import math
import random
import time
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database.influx import db_manager
from app.websocket.manager import ws_manager
from app.mqtt.client import mqtt_consumer
from app.services.telemetry_service import telemetry_service
from app.api.routes import router as api_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("esp32_monitor")

# Background simulation task when DEMO_MODE is true
async def demo_simulator_task():
    logger.info("Demo simulator task started (DEMO_MODE=True).")
    t = 0
    device_id = "ESP32-001"
    while True:
        try:
            now_ms = int(time.time() * 1000)
            t += 0.5
            
            # Realistic synthetic variations
            noise_v = random.uniform(-0.8, 0.8)
            noise_i = random.uniform(-0.1, 0.1)
            voltage = round(230.0 + 3.0 * math.sin(t * 0.2) + noise_v, 1)
            current = round(max(0.2, 4.2 + 0.8 * math.cos(t * 0.15) + noise_i), 2)
            power = round(voltage * current * 0.95, 1)
            frequency = round(50.0 + 0.05 * math.sin(t * 0.4) + random.uniform(-0.02, 0.02), 2)
            rssi = random.randint(-65, -55)
            uptime = int(t)

            sim_data = {
                "device_id": device_id,
                "timestamp": now_ms,
                "voltage": voltage,
                "current": current,
                "power": power,
                "frequency": frequency,
                "rssi": rssi,
                "uptime": uptime,
                "firmware_version": "1.0.0-sim"
            }

            await telemetry_service.process_telemetry(sim_data, is_simulated=True)
            await asyncio.sleep(0.5)  # 500 ms sampling rate
        except asyncio.CancelledError:
            logger.info("Demo simulator task cancelled.")
            break
        except Exception as e:
            logger.error(f"Error in demo simulator loop: {e}")
            await asyncio.sleep(1)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting ESP32 Energy Monitor Backend...")
    loop = asyncio.get_running_loop()
    telemetry_service.set_event_loop(loop)
    
    # Connect to InfluxDB
    db_manager.connect()
    
    # Start MQTT consumer
    mqtt_consumer.start()

    # If DEMO_MODE is active, start background simulator
    sim_task = None
    if settings.DEMO_MODE:
        sim_task = asyncio.create_task(demo_simulator_task())

    yield

    # Shutdown
    logger.info("Shutting down ESP32 Energy Monitor Backend...")
    if sim_task:
        sim_task.cancel()
    mqtt_consumer.stop()
    db_manager.close()

app = FastAPI(
    title="ESP32 Energy Monitor API",
    description="Real-time telemetry backend, InfluxDB OSS time-series pipeline, and WebSocket streamer for ESP32 energy meter.",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
cors_origins = [orig.strip() for orig in settings.CORS_ORIGINS.split(",")] if settings.CORS_ORIGINS != "*" else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include REST Routes
app.include_router(api_router)

# WebSocket Endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # Keep socket open and process any incoming ping/messages
        while True:
            data = await websocket.receive_text()
            # Optional ping-pong response
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WebSocket client error: {e}")
        ws_manager.disconnect(websocket)

# ⚡ PulseIoT - ESP32 Real-Time Energy Monitor & Oscilloscope Pipeline

**Live Deployed Server**: [https://energy-meter-5jie.onrender.com/](https://energy-meter-5jie.onrender.com/)

A complete industrial-grade IoT telemetry pipeline:
**ESP32 (C++ / Wi-Fi) → MQTT (Mosquitto) → FastAPI Backend → InfluxDB OSS (7-Day Retention) → WebSocket → React Dashboard (Vite + TypeScript + Tailwind CSS + Apache ECharts)**.

---

## 🚀 Architecture Diagram

```
ESP32 (Firmware)
   │ (Wi-Fi 2.4 GHz)
   ▼
Eclipse Mosquitto (MQTT: devices/{device_id}/telemetry)
   │
   ▼
FastAPI Backend
   ├─── Write (500ms) ───────────────► InfluxDB OSS (Bucket: esp32_data, Retention: 7d)
   │                                           ▲
   │                                           │ Query downsampled (1h/6h/1d/3d/7d)
   └─── Real-time Broadcast (/ws) ─────────────┼────────┐
                                               │        ▼
                                               └──► React Dashboard (ECharts + Live Waveform)
```

---

## 📁 Project Structure

```
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI server, lifespan, CORS, /ws
│   │   ├── config.py                # Pydantic BaseSettings loading from .env
│   │   ├── models/telemetry.py      # Telemetry models & response types
│   │   ├── database/influx.py       # InfluxDB client, 7d retention setup, downsampling
│   │   ├── mqtt/client.py           # Paho MQTT subscriber (devices/+/telemetry)
│   │   ├── websocket/manager.py     # ConnectionManager for live broadcasting
│   │   ├── services/telemetry_service.py # Validation, status engine, write & broadcast
│   │   └── api/routes.py            # REST endpoints (/health, /api/devices, /history, /export)
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.tsx           # Device ID, ONLINE/OFFLINE badge, theme toggle
│   │   │   ├── MetricCards.tsx      # Exactly 4 cards: Voltage, Current, Power, Frequency
│   │   │   ├── RealtimeWaveform.tsx # Apache ECharts, [V][I][P], [15s][30s][60s], zoom/pan/pause
│   │   │   ├── HistoryView.tsx      # 7-Day downsampled history, [1H][6H][1D][3D][7D], CSV Export
│   │   │   └── DeviceStatus.tsx     # Compact footer with Wi-Fi RSSI & last seen timer
│   │   ├── services/
│   │   │   ├── api.ts               # REST API client
│   │   │   └── websocket.ts         # Auto-reconnecting WebSocket client
│   │   ├── types/telemetry.ts       # TypeScript interfaces
│   │   ├── App.tsx                  # Main layout
│   │   ├── index.css                # Dark / Light theme tokens & styles
│   │   └── main.tsx
│   ├── vite.config.ts
│   ├── package.json
│   └── Dockerfile
│
├── firmware/
│   └── esp32/
│       └── esp32_energy_monitor.ino # C++ ESP32 firmware with Wi-Fi/MQTT auto-reconnect
│
├── simulator/
│   └── simulate_mqtt.py             # Standalone Python MQTT publisher for bench testing
│
├── mosquitto/
│   └── mosquitto.conf               # Port 1883 listener & persistence configuration
│
├── docker-compose.yml               # Multi-container orchestration
├── .env.example                     # Environment template
└── README.md
```

---

## ⚡ Quick Start with Docker Compose

To start the entire pipeline (Mosquitto + InfluxDB + FastAPI + React) in one command:

```bash
docker compose up -d
```

- **React Dashboard**: [http://localhost:3000](http://localhost:3000)
- **FastAPI Documentation**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **InfluxDB OSS UI**: [http://localhost:8086](http://localhost:8086)
- **Mosquitto MQTT Broker**: `localhost:1883`

---

## 🛠️ Local Development (Without Docker)

### 1. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Runs at [http://localhost:3000](http://localhost:3000).

### 2. Backend Setup
```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate | Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Run MQTT Simulator (Optional)
```bash
cd simulator
python simulate_mqtt.py
```

---

## 📡 MQTT Topic & Telemetry Schema

- **Topic**: `devices/{device_id}/telemetry` (e.g. `devices/ESP32-001/telemetry`)
- **Backend Subscribes**: `devices/+/telemetry`
- **Payload Format**:
```json
{
  "device_id": "ESP32-001",
  "timestamp": 1788950000000,
  "voltage": 242.3,
  "current": 4.11,
  "power": 970.3,
  "frequency": 50.1,
  "rssi": -52,
  "uptime": 1204,
  "firmware_version": "1.0.0"
}
```

---

## 🔌 REST API Endpoints

- `GET /health` - Service health & database connectivity
- `GET /api/devices` - List of active/registered ESP32 devices
- `GET /api/devices/{device_id}/latest` - Latest readings and online status
- `GET /api/devices/{device_id}/history?range=7d&field=voltage` - Downsampled historical time series (`1h`, `6h`, `1d`, `3d`, `7d`)
- `GET /api/devices/{device_id}/statistics?range=7d&field=voltage` - Current, Min, Max, Average metrics
- `GET /api/devices/{device_id}/export?range=7d` - RFC-standard CSV download
- `WebSocket /ws` - Full-duplex real-time telemetry stream

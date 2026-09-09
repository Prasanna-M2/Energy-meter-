// server.js - Professional Industrial ESP32 Energy Monitor Server
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DB_FILE = path.join(__dirname, 'telemetry.json');
const DIST_DIR = path.join(__dirname, 'frontend', 'dist');

app.use(cors());
app.use(express.json());

// Serve React production build if available, otherwise serve root
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
}
app.use(express.static(path.join(__dirname)));

// Device state tracker
const deviceState = {
  deviceId: 'ESP32-001',
  online: true,
  lastSeen: Date.now(),
  rssi: -56
};

// Database helper functions
function readTelemetryDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([]));
    return [];
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading telemetry.json:', err);
    return [];
  }
}

function writeTelemetryDB(records) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2));
  } catch (err) {
    console.error('Error writing telemetry.json:', err);
  }
}

// Ensure at least some initial seed data exists so 7-day charts and statistics render immediately
function ensureInitialData() {
  const records = readTelemetryDB();
  if (records.length === 0) {
    console.log('[Seed] Generating initial historical telemetry records...');
    const seed = [];
    const now = Date.now();
    // Generate 7 days of downsampled data (1 point every 30 minutes = 336 points)
    for (let i = 336; i >= 0; i--) {
      const ts = now - (i * 30 * 60 * 1000);
      const tSec = ts / 1000;
      const v = 230 + 3.0 * Math.sin(tSec * 0.001) + (Math.random() - 0.5) * 1.5;
      const c = 4.1 + 0.9 * Math.cos(tSec * 0.0008) + (Math.random() - 0.5) * 0.3;
      const p = v * c * 0.95;
      const f = 50.0 + (Math.random() - 0.5) * 0.08;
      seed.push({
        id: seed.length + 1,
        deviceId: 'ESP32-001',
        timestamp: ts,
        voltage: Math.round(v * 10) / 10,
        current: Math.round(c * 100) / 100,
        power: Math.round(p * 10) / 10,
        frequency: Math.round(f * 10) / 10,
        rssi: -58 + Math.floor(Math.random() * 8),
        uptime: 10000 + (336 - i) * 1800
      });
    }
    writeTelemetryDB(seed);
  }
}
ensureInitialData();

// Broadcast WebSocket payload
function broadcast(payload) {
  const str = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  });
}

// Background simulation ticker for local demo mode (2 readings / second = 500ms)
let simTick = 0;
setInterval(() => {
  const now = Date.now();
  simTick += 0.5;
  const v = Math.round((230 + 3.2 * Math.sin(simTick * 0.18) + (Math.random() - 0.5)) * 10) / 10;
  const c = Math.round(Math.max(0.5, (4.15 + 0.9 * Math.cos(simTick * 0.12) + (Math.random() - 0.5) * 0.1)) * 100) / 100;
  const p = Math.round((v * c * 0.95) * 10) / 10;
  const f = Math.round((50.0 + (Math.random() - 0.5) * 0.06) * 10) / 10;

  deviceState.lastSeen = now;
  deviceState.online = true;

  const wsMsg = {
    type: 'telemetry',
    device_id: deviceState.deviceId,
    timestamp: now,
    data: {
      voltage: v,
      current: c,
      power: p,
      frequency: f,
      rssi: deviceState.rssi,
      uptime: Math.floor(simTick),
      status: 'ONLINE'
    }
  };

  broadcast(wsMsg);
}, 500);

// ==========================================
// REST API ROUTES
// ==========================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    active_devices: 1,
    time: new Date().toISOString()
  });
});

app.get('/api/devices', (req, res) => {
  const elapsed = (Date.now() - deviceState.lastSeen) / 1000;
  const status = elapsed < 5 ? 'ONLINE' : elapsed <= 15 ? 'WARNING' : 'OFFLINE';
  res.json([
    {
      device_id: deviceState.deviceId,
      status,
      last_seen: deviceState.lastSeen / 1000,
      rssi: deviceState.rssi,
      uptime: Math.floor(process.uptime()),
      firmware_version: '1.0.0'
    }
  ]);
});

app.get('/api/devices/:deviceId/latest', (req, res) => {
  const records = readTelemetryDB();
  const latest = records.length > 0 ? records[records.length - 1] : null;
  const elapsed = (Date.now() - deviceState.lastSeen) / 1000;
  res.json({
    device_id: req.params.deviceId,
    status: elapsed < 5 ? 'ONLINE' : elapsed <= 15 ? 'WARNING' : 'OFFLINE',
    last_seen_seconds_ago: Math.round(elapsed * 10) / 10,
    telemetry: latest
  });
});

app.get('/api/devices/:deviceId/history', (req, res) => {
  const range = (req.query.range || '7d').toLowerCase();
  const field = (req.query.field || 'voltage').toLowerCase();
  const now = Date.now();
  
  let windowMs = 7 * 24 * 60 * 60 * 1000;
  if (range === '1h') windowMs = 1 * 60 * 60 * 1000;
  else if (range === '6h') windowMs = 6 * 60 * 60 * 1000;
  else if (range === '1d') windowMs = 24 * 60 * 60 * 1000;
  else if (range === '3d') windowMs = 3 * 24 * 60 * 60 * 1000;
  else if (range === '7d') windowMs = 7 * 24 * 60 * 60 * 1000;

  const records = readTelemetryDB();
  const filtered = records.filter(r => r.timestamp >= (now - windowMs));

  // Transform and downsample
  const maxTargetPoints = 200;
  let sampled = filtered;
  if (filtered.length > maxTargetPoints) {
    const step = Math.ceil(filtered.length / maxTargetPoints);
    sampled = [];
    for (let i = 0; i < filtered.length; i += step) {
      sampled.push(filtered[i]);
    }
  }

  const dataPoints = sampled.map(r => ({
    time: new Date(r.timestamp).toISOString(),
    timestamp: r.timestamp,
    value: r[field] !== undefined ? r[field] : r.voltage || 0.0
  }));

  res.json({
    device_id: req.params.deviceId,
    range,
    field,
    count: dataPoints.length,
    data: dataPoints
  });
});

app.get('/api/devices/:deviceId/statistics', (req, res) => {
  const range = (req.query.range || '7d').toLowerCase();
  const field = (req.query.field || 'voltage').toLowerCase();
  const now = Date.now();

  let windowMs = 7 * 24 * 60 * 60 * 1000;
  if (range === '1h') windowMs = 1 * 60 * 60 * 1000;
  else if (range === '6h') windowMs = 6 * 60 * 60 * 1000;
  else if (range === '1d') windowMs = 24 * 60 * 60 * 1000;
  else if (range === '3d') windowMs = 3 * 24 * 60 * 60 * 1000;

  const records = readTelemetryDB();
  const filtered = records.filter(r => r.timestamp >= (now - windowMs));
  const values = filtered.map(r => r[field] !== undefined ? r[field] : (r.voltage || 0)).filter(v => typeof v === 'number');

  if (values.length === 0) {
    return res.json({
      device_id: req.params.deviceId,
      range,
      field,
      current: 0,
      min: 0,
      max: 0,
      avg: 0
    });
  }

  const current = values[values.length - 1];
  const min = Math.round(Math.min(...values) * 100) / 100;
  const max = Math.round(Math.max(...values) * 100) / 100;
  const avg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;

  res.json({
    device_id: req.params.deviceId,
    range,
    field,
    current,
    min,
    max,
    avg
  });
});

app.get('/api/devices/:deviceId/export', (req, res) => {
  const range = (req.query.range || '7d').toLowerCase();
  const now = Date.now();
  let windowMs = 7 * 24 * 60 * 60 * 1000;
  if (range === '1h') windowMs = 1 * 60 * 60 * 1000;
  else if (range === '6h') windowMs = 6 * 60 * 60 * 1000;
  else if (range === '1d') windowMs = 24 * 60 * 60 * 1000;
  else if (range === '3d') windowMs = 3 * 24 * 60 * 60 * 1000;

  const records = readTelemetryDB();
  const filtered = records.filter(r => r.timestamp >= (now - windowMs));

  let csvContent = 'timestamp,device_id,voltage,current,power,frequency\n';
  filtered.forEach(r => {
    csvContent += `${new Date(r.timestamp).toISOString()},${r.deviceId || req.params.deviceId},${r.voltage || 0},${r.current || 0},${r.power || 0},${r.frequency || 50}\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=telemetry_${req.params.deviceId}_${range}.csv`);
  res.send(csvContent);
});

// Fallback to index.html for single-page React app routing
app.get('*', (req, res) => {
  const distIndex = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex);
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[PulseIoT] Production Telemetry Server active on http://localhost:${PORT}`);
});

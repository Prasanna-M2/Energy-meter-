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

// Serve Root Studio Web App (index.html, style.css, app.js)
app.use(express.static(path.join(__dirname)));

const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycbxf5t53HsO86RILYOTeRcLagFd0ud0LNnVmGa5ClLZaD8CAI-qJmiaqBKaw1XeMGJH0gA/exec';
let lastSheetLog = 0;

function logToGoogleSheet(record) {
  if (!GOOGLE_SHEET_WEBHOOK_URL) return;
  // Rate limit to once every 5 seconds so Google Apps Script doesn't throttle
  const now = Date.now();
  if (now - lastSheetLog < 5000) return;
  lastSheetLog = now;

  fetch(GOOGLE_SHEET_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      voltage: record.voltage,
      current: record.current,
      power: record.power,
      energy: record.energy || 0,
      frequency: record.frequency,
      pf: record.pf || 1.0,
      device_id: record.deviceId
    })
  }).then(r => r.text()).then(() => {
    console.log('[Google Sheets] Telemetry row appended successfully');
  }).catch(err => {
    console.warn('[Google Sheets] Log error:', err.message);
  });
}

// Device state tracker (Only tracks REAL ESP32 data)
const deviceState = {
  deviceId: 'ESP32-001',
  online: false,
  lastSeen: 0,
  rssi: 0
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

// Broadcast WebSocket payload
function broadcast(payload) {
  const str = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  });
}

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

// ESP32 Telemetry Ingestion Endpoint
app.post('/api/telemetry', (req, res) => {
  const body = req.body || {};
  const deviceId = body.device_id || req.body.deviceId || 'ESP32-001';
  const now = body.timestamp || Date.now();
  
  const voltage = parseFloat(body.voltage) || 0.0;
  const current = parseFloat(body.current) || 0.0;
  const power = parseFloat(body.power) || (voltage * current * 0.96);
  const frequency = parseFloat(body.frequency) || 50.0;
  const rssi = parseInt(body.rssi) || -55;
  const uptime = parseInt(body.uptime) || 0;

  deviceState.deviceId = deviceId;
  deviceState.lastSeen = Date.now();
  deviceState.online = true;
  deviceState.rssi = rssi;

  const record = {
    id: Date.now(),
    deviceId,
    timestamp: now,
    voltage: Math.round(voltage * 10) / 10,
    current: Math.round(current * 100) / 100,
    power: Math.round(power * 10) / 10,
    frequency: Math.round(frequency * 10) / 10,
    rssi,
    uptime
  };

  // Persist record
  const records = readTelemetryDB();
  records.push(record);
  // Keep last 5000 records
  if (records.length > 5000) records.shift();
  writeTelemetryDB(records);

  // Broadcast to WebSockets
  const wsMsg = {
    type: 'telemetry',
    device_id: deviceId,
    timestamp: now,
    data: {
      voltage: record.voltage,
      current: record.current,
      power: record.power,
      frequency: record.frequency,
      rssi: record.rssi,
      uptime: record.uptime,
      status: 'ONLINE'
    }
  };
  broadcast(wsMsg);

  // Asynchronously forward to Google Sheets if configured
  logToGoogleSheet(record);

  res.status(200).json({ status: 'success', message: 'Telemetry received' });
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

// Fallback to studio index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[PulseIoT] Production Telemetry Server active on http://localhost:${PORT}`);
});

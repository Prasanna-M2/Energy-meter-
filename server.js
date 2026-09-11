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

let latestTelemetryForSheet = null;

function queueTelemetryForSheet(record) {
  latestTelemetryForSheet = record;
}

// STRICT 5-SECOND GOOGLE SHEETS LOGGER
// Always fires every 5000ms. If ESP32 or supply is disconnected, logs 0.0 values!
setInterval(() => {
  if (!GOOGLE_SHEET_WEBHOOK_URL) return;

  const now = Date.now();
  const elapsed = (now - deviceState.lastSeen) / 1000;
  const isOnline = deviceState.lastSeen > 0 && elapsed < 8; // 8s window for 5s sends

  let recordToLog;
  if (!isOnline || !latestTelemetryForSheet) {
    recordToLog = {
      voltage: 0.0,
      current: 0.0,
      power: 0.0,
      energy: latestTelemetryForSheet ? (latestTelemetryForSheet.energy || 0) : 0,
      frequency: 0.0,
      pf: 0.0,
      deviceId: deviceState.deviceId || 'ESP32-001'
    };
  } else {
    recordToLog = latestTelemetryForSheet;
  }

  fetch(GOOGLE_SHEET_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      voltage: recordToLog.voltage,
      current: recordToLog.current,
      power: recordToLog.power,
      energy: recordToLog.energy || 0,
      frequency: recordToLog.frequency,
      pf: recordToLog.pf || 0.0,
      device_id: recordToLog.deviceId || 'ESP32-001'
    })
  }).then(r => r.text()).then(() => {
    console.log('[Google Sheets] Telemetry logged (exact 5s interval):', recordToLog.voltage + 'V, ' + recordToLog.current + 'A, ' + recordToLog.power + 'W');
  }).catch(err => {
    console.warn('[Google Sheets] Log error:', err.message);
  });
}, 5000);

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
  
  // Parse incoming values safely without falling back to non-zero defaults
  const voltage = (typeof body.voltage !== 'undefined' && !isNaN(parseFloat(body.voltage))) ? parseFloat(body.voltage) : 0.0;
  const current = (typeof body.current !== 'undefined' && !isNaN(parseFloat(body.current))) ? parseFloat(body.current) : 0.0;
  const power = (typeof body.power !== 'undefined' && !isNaN(parseFloat(body.power))) ? parseFloat(body.power) : 0.0;
  const frequency = (typeof body.frequency !== 'undefined' && !isNaN(parseFloat(body.frequency))) ? parseFloat(body.frequency) : 0.0;
  
  // Support both 'energy' and 'kwh'
  const energyRaw = (typeof body.energy !== 'undefined') ? body.energy : (typeof body.kwh !== 'undefined' ? body.kwh : undefined);
  const energy = (typeof energyRaw !== 'undefined' && !isNaN(parseFloat(energyRaw))) ? parseFloat(energyRaw) : 0.0;
  
  // Support both 'pf' and 'power_factor'
  const pfRaw = (typeof body.pf !== 'undefined') ? body.pf : (typeof body.power_factor !== 'undefined' ? body.power_factor : undefined);
  const pf = (typeof pfRaw !== 'undefined' && !isNaN(parseFloat(pfRaw))) ? parseFloat(pfRaw) : 0.0;

  const rssi = parseInt(body.rssi) || -55;
  const uptime = parseInt(body.uptime) || 0;

  deviceState.deviceId = deviceId;
  deviceState.lastSeen = Date.now();
  deviceState.online = true;
  deviceState.rssi = rssi;

  const isSensorConnected = voltage > 5.0;

  const record = {
    id: Date.now(),
    deviceId,
    timestamp: now,
    voltage: Math.round(voltage * 10) / 10,
    current: Math.round(current * 100) / 100,
    power: Math.round(power * 10) / 10,
    frequency: Math.round(frequency * 10) / 10,
    energy: Math.round(energy * 10000) / 10000,
    pf: Math.round(pf * 100) / 100,
    rssi,
    uptime,
    status: isSensorConnected ? 'ONLINE' : 'DISCONNECTED (0V)'
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
      energy: record.energy,
      pf: record.pf,
      rssi: record.rssi,
      uptime: record.uptime,
      status: record.status
    }
  };
  broadcast(wsMsg);

  // Queue for exact 5-second Google Sheets scheduler
  queueTelemetryForSheet(record);

  res.status(200).json({ status: 'success', message: 'Telemetry received' });
});

// Watchdog: If no telemetry received for > 15 seconds (allows 5s send interval + network latency), broadcast OFFLINE
setInterval(() => {
  const elapsed = (Date.now() - deviceState.lastSeen) / 1000;
  if (deviceState.lastSeen > 0 && elapsed >= 15 && deviceState.online) {
    deviceState.online = false;
    const records = readTelemetryDB();
    const lastEnergy = (records.length > 0 && records[records.length - 1].energy) ? records[records.length - 1].energy : 0.0;
    broadcast({
      type: 'telemetry',
      device_id: deviceState.deviceId,
      timestamp: Date.now(),
      data: {
        voltage: 0.0,
        current: 0.0,
        power: 0.0,
        frequency: 0.0,
        energy: lastEnergy, // Retain accumulated kWh
        pf: 0.0,
        rssi: -127,
        uptime: 0,
        status: 'OFFLINE'
      }
    });
  }
}, 1000);

app.get('/api/devices', (req, res) => {
  const elapsed = (Date.now() - deviceState.lastSeen) / 1000;
  const status = (deviceState.lastSeen === 0 || elapsed > 25) ? 'OFFLINE' : (elapsed > 15 ? 'WARNING' : 'ONLINE');
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
  const isOnline = deviceState.lastSeen > 0 && elapsed < 15;
  const isWarning = elapsed >= 15 && elapsed <= 25;
  const status = isOnline ? 'ONLINE' : (isWarning ? 'WARNING' : 'OFFLINE');

  // STRICT REQUIREMENT: When supply or device is disconnected (offline), return 0.0!
  let telemetryToSend;
  if (!isOnline) {
    telemetryToSend = {
      id: Date.now(),
      deviceId: req.params.deviceId,
      timestamp: Date.now(),
      voltage: 0.0,
      current: 0.0,
      power: 0.0,
      frequency: 0.0,
      energy: latest ? (latest.energy || 0.0) : 0.0,
      pf: 0.0,
      rssi: -127,
      uptime: 0,
      status: 'OFFLINE'
    };
  } else {
    telemetryToSend = latest;
  }

  res.json({
    device_id: req.params.deviceId,
    status,
    last_seen_seconds_ago: Math.round(elapsed * 10) / 10,
    telemetry: telemetryToSend
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

// Google Sheets Synchronized Data & Analytics API
app.get('/api/sheets-data', (req, res) => {
  const records = readTelemetryDB();
  const sampled = records.slice(-500); // Last 500 points for crisp charting

  const totalPoints = records.length;
  const powers = records.map(r => r.power || 0);
  const voltages = records.map(r => r.voltage || 0);
  const currents = records.map(r => r.current || 0);
  const pfs = records.map(r => r.pf || 0).filter(p => p > 0);
  const energies = records.map(r => r.energy || 0);

  const latestEnergy = energies.length > 0 ? energies[energies.length - 1] : 0.0;
  const peakPower = powers.length > 0 ? Math.max(...powers) : 0.0;
  const avgVoltage = voltages.length > 0 ? (voltages.reduce((a, b) => a + b, 0) / voltages.length) : 0.0;
  const avgCurrent = currents.length > 0 ? (currents.reduce((a, b) => a + b, 0) / currents.length) : 0.0;
  const avgPF = pfs.length > 0 ? (pfs.reduce((a, b) => a + b, 0) / pfs.length) : 0.0;

  res.json({
    status: 'success',
    total_records: totalPoints,
    latest_energy_kwh: Math.round(latestEnergy * 10000) / 10000,
    peak_power_w: Math.round(peakPower * 10) / 10,
    avg_voltage_v: Math.round(avgVoltage * 10) / 10,
    avg_current_a: Math.round(avgCurrent * 100) / 100,
    avg_pf: Math.round(avgPF * 100) / 100,
    records: sampled.map(r => ({
      timestamp: r.timestamp,
      time: new Date(r.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      iso: new Date(r.timestamp).toISOString(),
      voltage: r.voltage || 0.0,
      current: r.current || 0.0,
      power: r.power || 0.0,
      energy: r.energy || 0.0,
      frequency: r.frequency || 50.0,
      pf: r.pf || 0.0
    }))
  });
});

// Fallback to studio index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[PulseIoT] Production Telemetry Server active on http://localhost:${PORT}`);
});

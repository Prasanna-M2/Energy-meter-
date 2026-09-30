// server.js - Professional Industrial ESP32 Energy Monitor Server
require('dotenv').config();
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

app.use(cors());
app.use(express.json());

// Serve Web Studio Assets (index.html, style.css, app.js)
app.use(express.static(path.join(__dirname)));

// ==============================================================================
// 1. CONFIGURATION & STATE
// ==============================================================================
let config = {
  googleSheetWebhookUrl: process.env.GOOGLE_SHEET_WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycbxwqlBZPsX6Mi0iyJWtiwra6S_pWYUDzfmpeoekIyOQU1c8HkBxVuj5BZvBI0h5YfEv1Q/exec',
  googleSheetEmbedUrl: process.env.GOOGLE_SHEET_EMBED_URL || 'https://docs.google.com/spreadsheets/d/1HfwPPmaKPXMQbgyVnA0lcn1-Qb0trAjJqRtT_kI4Rac/edit?usp=sharing',
  sheetLogIntervalMs: 10000,
  gcsBucketName: process.env.GCS_BUCKET_NAME || 'esp32-energy-telemetry-5tb',
  gcsEnabled: process.env.GCS_ENABLED === 'true'
};

// Google Cloud Storage (5TB Cloud Bucket Integration)
let gcsBucket = null;
try {
  const { Storage } = require('@google-cloud/storage');
  const gcsKeyPath = process.env.GCS_KEY_FILE || path.join(__dirname, 'gcp-key.json');
  if (fs.existsSync(gcsKeyPath)) {
    const storage = new Storage({ keyFilename: gcsKeyPath, projectId: process.env.GCS_PROJECT_ID });
    gcsBucket = storage.bucket(config.gcsBucketName);
    console.log(`[Google Cloud Storage] Initialized 5TB Cloud Bucket: gs://${config.gcsBucketName}`);
  } else {
    console.log(`[Google Cloud Storage] Standing by. To connect 5TB GCS, place your GCP service account key at ${gcsKeyPath}`);
  }
} catch (e) {
  console.warn('[Google Cloud Storage] SDK notice:', e.message);
}

async function uploadRecordToGCS(record) {
  if (!gcsBucket || !config.gcsEnabled) return;
  try {
    const d = new Date(record.timestamp || Date.now());
    const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
    const hourStr = String(d.getHours()).padStart(2, '0'); // HH
    const fileName = `telemetry/${record.deviceId || 'ESP32-001'}/${dateStr}/hour_${hourStr}.jsonl`;
    const file = gcsBucket.file(fileName);
    
    const formattedRecord = {
      timestamp: d.toISOString(),
      timestamp_unix: record.timestamp || Date.now(),
      date: dateStr,
      time: d.toLocaleTimeString([], { hour12: false }),
      device_id: record.deviceId || 'ESP32-001',
      voltage: record.voltage || 0.0,
      current: record.current || 0.0,
      power: record.power || 0.0,
      frequency: record.frequency || 50.0,
      energy: record.energy || 0.0,
      pf: record.pf || 0.0,
      rssi: record.rssi || -55,
      status: record.status || (record.voltage > 5.0 ? 'ONLINE' : 'DISCONNECTED')
    };

    const line = JSON.stringify(formattedRecord) + '\n';
    await file.save(line, { append: true, metadata: { contentType: 'application/x-ndjson' } });
    console.log(`[Google Cloud Storage] Saved record to gs://${config.gcsBucketName}/${fileName}`);
  } catch (err) {
    console.warn('[Google Cloud Storage] Upload error:', err.message);
  }
}


const deviceState = {
  deviceId: 'ESP32-001',
  online: false,
  lastSeen: 0,
  rssi: 0,
  latestData: null,
  offlineLogged: false
};

// In-Memory Ring Buffer for 0ms Event-Loop Latency
let telemetryRecords = [];
let isDbDirty = false;

function loadTelemetryDB() {
  if (!fs.existsSync(DB_FILE)) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify([]));
    } catch (e) {
      console.warn('Could not initialize telemetry.json:', e.message);
    }
    return [];
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    console.log(`[Database] Loaded ${parsed.length} historical records into memory cache.`);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Error reading telemetry.json:', err.message);
    return [];
  }
}

telemetryRecords = loadTelemetryDB();

// Asynchronous debounced background persistence (flushes every 5 seconds if dirty)
setInterval(() => {
  if (isDbDirty) {
    isDbDirty = false;
    fs.writeFile(DB_FILE, JSON.stringify(telemetryRecords, null, 2), (err) => {
      if (err) console.error('[Database] Background save error:', err.message);
    });
  }
}, 5000);

// Broadcast WebSocket payload
function broadcast(payload) {
  const str = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  });
}

// ==============================================================================
// 2. SMART GOOGLE SHEETS LOGGER & DATA SHARING ENGINE
// ==============================================================================

async function postToGoogleSheets(record, isManual = false) {
  if (!config.googleSheetWebhookUrl) {
    return { success: false, message: 'Google Sheets Webhook URL is not configured' };
  }

  const payload = {
    timestamp: record.timestamp ? new Date(record.timestamp).toISOString() : new Date().toISOString(),
    device_id: record.deviceId || record.device_id || deviceState.deviceId || 'ESP32-001',
    voltage: typeof record.voltage === 'number' ? record.voltage : 0.0,
    current: typeof record.current === 'number' ? record.current : 0.0,
    power: typeof record.power === 'number' ? record.power : 0.0,
    energy: typeof record.energy === 'number' ? record.energy : 0.0,
    frequency: typeof record.frequency === 'number' ? record.frequency : 0.0,
    pf: typeof record.pf === 'number' ? record.pf : 0.0,
    status: record.status || (record.voltage > 5.0 ? 'ONLINE' : 'DISCONNECTED')
  };

  const startTime = Date.now();
  try {
    const response = await fetch(config.googleSheetWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const latencyMs = Date.now() - startTime;
    const text = await response.text();
    let jsonResult = null;
    try {
      jsonResult = JSON.parse(text);
    } catch (_) {}

    const isSuccess = response.ok || (jsonResult && jsonResult.result === 'success');
    console.log(`[Google Sheets] ${isManual ? 'MANUAL' : 'AUTO'} Log ${isSuccess ? 'SUCCESS' : 'FAILED'} (${latencyMs}ms): V=${payload.voltage}V, I=${payload.current}A, P=${payload.power}W, Status=${payload.status}`);

    return {
      success: isSuccess,
      latencyMs,
      response: jsonResult || text,
      status: response.status
    };
  } catch (err) {
    console.warn('[Google Sheets] Transmission error:', err.message);
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: err.message
    };
  }
}

// Scheduled Logger:
// Only logs when device is ONLINE every config.sheetLogIntervalMs.
// When device transitions to OFFLINE, logs EXACTLY ONCE, then pauses to protect Google quota.
let lastSheetLogTime = 0;
setInterval(() => {
  const now = Date.now();
  const elapsedSinceSeen = (now - deviceState.lastSeen) / 1000;
  const isOnline = deviceState.lastSeen > 0 && elapsedSinceSeen < 15;

  if (isOnline) {
    deviceState.offlineLogged = false;
    if (now - lastSheetLogTime >= config.sheetLogIntervalMs && deviceState.latestData) {
      lastSheetLogTime = now;
      postToGoogleSheets(deviceState.latestData, false);
    }
  } else if (!isOnline && deviceState.lastSeen > 0 && !deviceState.offlineLogged) {
    // Device recently transitioned from online to offline: Log ONCE to document disconnection
    deviceState.offlineLogged = true;
    lastSheetLogTime = now;
    const lastEnergy = deviceState.latestData ? (deviceState.latestData.energy || 0.0) : 0.0;
    postToGoogleSheets({
      timestamp: now,
      deviceId: deviceState.deviceId,
      voltage: 0.0,
      current: 0.0,
      power: 0.0,
      energy: lastEnergy,
      frequency: 0.0,
      pf: 0.0,
      status: 'OFFLINE'
    }, false);
    console.log('[Google Sheets] Device went offline. Logged offline transition state. Logging paused to protect quotas.');
  }
}, 3000);

// Watchdog: If no telemetry received for > 15s, broadcast OFFLINE
setInterval(() => {
  const elapsed = (Date.now() - deviceState.lastSeen) / 1000;
  if (deviceState.lastSeen > 0 && elapsed >= 15 && deviceState.online) {
    deviceState.online = false;
    const lastEnergy = (telemetryRecords.length > 0 && telemetryRecords[telemetryRecords.length - 1].energy) ? telemetryRecords[telemetryRecords.length - 1].energy : 0.0;
    broadcast({
      type: 'telemetry',
      device_id: deviceState.deviceId,
      timestamp: Date.now(),
      data: {
        voltage: 0.0,
        current: 0.0,
        power: 0.0,
        frequency: 0.0,
        energy: lastEnergy,
        pf: 0.0,
        rssi: -127,
        uptime: 0,
        status: 'OFFLINE'
      }
    });
  }
}, 1000);

// ==============================================================================
// 3. REST API ENDPOINTS
// ==============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    active_devices: deviceState.online ? 1 : 0,
    cached_records: telemetryRecords.length,
    time: new Date().toISOString()
  });
});

// Telemetry Ingestion (ESP32 -> Server)
app.post('/api/telemetry', (req, res) => {
  const body = req.body || {};
  const deviceId = body.device_id || body.deviceId || 'ESP32-001';
  const now = body.timestamp || Date.now();

  const voltage = (typeof body.voltage !== 'undefined' && !isNaN(parseFloat(body.voltage))) ? parseFloat(body.voltage) : 0.0;
  const current = (typeof body.current !== 'undefined' && !isNaN(parseFloat(body.current))) ? parseFloat(body.current) : 0.0;
  const power = (typeof body.power !== 'undefined' && !isNaN(parseFloat(body.power))) ? parseFloat(body.power) : 0.0;
  const frequency = (typeof body.frequency !== 'undefined' && !isNaN(parseFloat(body.frequency))) ? parseFloat(body.frequency) : 0.0;

  const energyRaw = (typeof body.energy !== 'undefined') ? body.energy : (typeof body.kwh !== 'undefined' ? body.kwh : undefined);
  const energy = (typeof energyRaw !== 'undefined' && !isNaN(parseFloat(energyRaw))) ? parseFloat(energyRaw) : 0.0;

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

  deviceState.latestData = record;

  // Append to in-memory buffer
  telemetryRecords.push(record);
  if (telemetryRecords.length > 5000) {
    telemetryRecords.shift();
  }
  isDbDirty = true;
  uploadRecordToGCS(record);

  // Real-time Google Sheets logging (Throttled by sheetLogIntervalMs to respect Google quota)
  const nowMs = Date.now();
  if (nowMs - lastSheetLogTime >= config.sheetLogIntervalMs || lastSheetLogTime === 0) {
    lastSheetLogTime = nowMs;
    postToGoogleSheets(record, false);
  }
  broadcast({
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
  });

  res.status(200).json({ status: 'success', message: 'Telemetry received' });
});

// Devices Summary
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

// Latest Telemetry for a Device
app.get('/api/devices/:deviceId/latest', (req, res) => {
  const latest = telemetryRecords.length > 0 ? telemetryRecords[telemetryRecords.length - 1] : null;
  const elapsed = (Date.now() - deviceState.lastSeen) / 1000;
  const isOnline = deviceState.lastSeen > 0 && elapsed < 15;
  const isWarning = elapsed >= 15 && elapsed <= 25;
  const status = isOnline ? 'ONLINE' : (isWarning ? 'WARNING' : 'OFFLINE');

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

// Helper: Query history from in-memory cache
function getHistoryRecords(deviceId, range, field) {
  const rangeLower = (range || '7d').toLowerCase();
  const fieldLower = (field || 'voltage').toLowerCase();
  const now = Date.now();

  let windowMs = 7 * 24 * 60 * 60 * 1000;
  if (rangeLower === '1h') windowMs = 1 * 60 * 60 * 1000;
  else if (rangeLower === '6h') windowMs = 6 * 60 * 60 * 1000;
  else if (rangeLower === '1d') windowMs = 24 * 60 * 60 * 1000;
  else if (rangeLower === '3d') windowMs = 3 * 24 * 60 * 60 * 1000;
  else if (rangeLower === '7d') windowMs = 7 * 24 * 60 * 60 * 1000;

  const filtered = telemetryRecords.filter(r => r.timestamp >= (now - windowMs));

  const maxTargetPoints = 100; // Graph representation limited to past 100 telemetry data points
  let sampled = filtered;
  if (filtered.length > maxTargetPoints) {
    // Take the most recent 100 data points
    sampled = filtered.slice(-100);
  }

  const dataPoints = sampled.map(r => ({
    time: new Date(r.timestamp).toISOString(),
    timestamp: r.timestamp,
    value: r[fieldLower] !== undefined ? r[fieldLower] : r.voltage || 0.0,
    voltage: r.voltage || 0.0,
    current: r.current || 0.0,
    power: r.power || 0.0,
    energy: r.energy || 0.0,
    frequency: r.frequency || 50.0,
    pf: r.pf || 0.0
  }));

  return {
    device_id: deviceId,
    range: rangeLower,
    field: fieldLower,
    count: dataPoints.length,
    data: dataPoints
  };
}

// History API Route & Query Parameter Alias
app.get('/api/devices/:deviceId/history', (req, res) => {
  const field = req.query.field || req.query.channel || 'voltage';
  res.json(getHistoryRecords(req.params.deviceId, req.query.range, field));
});

app.get('/api/history', (req, res) => {
  const deviceId = req.query.deviceId || deviceState.deviceId || 'ESP32-001';
  const field = req.query.field || req.query.channel || 'voltage';
  res.json(getHistoryRecords(deviceId, req.query.range, field));
});

// Recent 50 Telemetry Records API (Sliding window of 50, deletes 1 by 1 as new arrives)
app.get('/api/telemetry/recent', (req, res) => {
  const last50 = telemetryRecords.slice(-50).map(r => ({
    id: r.id || r.timestamp,
    timestamp: r.timestamp,
    date: new Date(r.timestamp).toISOString().split('T')[0],
    time: new Date(r.timestamp).toLocaleTimeString([], { hour12: false }),
    deviceId: r.deviceId || 'ESP32-001',
    voltage: r.voltage || 0.0,
    current: r.current || 0.0,
    power: r.power || 0.0,
    energy: r.energy || 0.0,
    frequency: r.frequency || 50.0,
    pf: r.pf || 0.0,
    status: r.status || (r.voltage > 5.0 ? 'ONLINE' : 'DISCONNECTED')
  }));
  res.json({
    count: last50.length,
    limit: 50,
    records: last50
  });
});

// Clear all telemetry data endpoint
app.post('/api/telemetry/clear', (req, res) => {
  telemetryRecords = [];
  deviceState.latestData = null;
  deviceState.lastSeen = 0;
  deviceState.online = false;
  isDbDirty = false;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify([]));
  } catch (e) {
    console.error('Error clearing telemetry.json:', e.message);
  }
  console.log('[Database] All sample and telemetry data cleared.');
  res.json({ status: 'success', message: 'All sample data cleared.', count: 0 });
});

app.delete('/api/telemetry', (req, res) => {
  telemetryRecords = [];
  deviceState.latestData = null;
  deviceState.lastSeen = 0;
  deviceState.online = false;
  isDbDirty = false;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify([]));
  } catch (e) {
    console.error('Error clearing telemetry.json:', e.message);
  }
  console.log('[Database] All sample and telemetry data cleared.');
  res.json({ status: 'success', message: 'All sample data cleared.', count: 0 });
});

// Helper: Query statistics
function getStatisticsData(deviceId, range, field) {
  const rangeLower = (range || '7d').toLowerCase();
  const fieldLower = (field || 'voltage').toLowerCase();
  const now = Date.now();

  let windowMs = 7 * 24 * 60 * 60 * 1000;
  if (rangeLower === '1h') windowMs = 1 * 60 * 60 * 1000;
  else if (rangeLower === '6h') windowMs = 6 * 60 * 60 * 1000;
  else if (rangeLower === '1d') windowMs = 24 * 60 * 60 * 1000;
  else if (rangeLower === '3d') windowMs = 3 * 24 * 60 * 60 * 1000;

  const filtered = telemetryRecords.filter(r => r.timestamp >= (now - windowMs));
  const values = filtered.map(r => r[fieldLower] !== undefined ? r[fieldLower] : (r.voltage || 0)).filter(v => typeof v === 'number');

  if (values.length === 0) {
    return { device_id: deviceId, range: rangeLower, field: fieldLower, current: 0, min: 0, max: 0, avg: 0 };
  }

  const current = values[values.length - 1];
  const min = Math.round(Math.min(...values) * 100) / 100;
  const max = Math.round(Math.max(...values) * 100) / 100;
  const avg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;

  return { device_id: deviceId, range: rangeLower, field: fieldLower, current, min, max, avg };
}

app.get('/api/devices/:deviceId/statistics', (req, res) => {
  const field = req.query.field || req.query.channel || 'voltage';
  res.json(getStatisticsData(req.params.deviceId, req.query.range, field));
});

app.get('/api/statistics', (req, res) => {
  const deviceId = req.query.deviceId || deviceState.deviceId || 'ESP32-001';
  const field = req.query.field || req.query.channel || 'voltage';
  res.json(getStatisticsData(deviceId, req.query.range, field));
});

// CSV Export: Export ALL historical records (100% complete dataset without truncation)
function generateCSV(deviceId, range) {
  // If range is 'all', export everything in telemetryRecords without filtering
  const rangeLower = (range || 'all').toLowerCase();
  let exportRecords = telemetryRecords;

  if (rangeLower !== 'all') {
    const now = Date.now();
    let windowMs = 7 * 24 * 60 * 60 * 1000;
    if (rangeLower === '1h') windowMs = 1 * 60 * 60 * 1000;
    else if (rangeLower === '6h') windowMs = 6 * 60 * 60 * 1000;
    else if (rangeLower === '1d') windowMs = 24 * 60 * 60 * 1000;
    else if (rangeLower === '3d') windowMs = 3 * 24 * 60 * 60 * 1000;
    else if (rangeLower === '7d') windowMs = 7 * 24 * 60 * 60 * 1000;
    exportRecords = telemetryRecords.filter(r => r.timestamp >= (now - windowMs));
  }

  let csvContent = 'timestamp_iso,date,time,device_id,voltage_v,current_a,power_w,energy_kwh,frequency_hz,power_factor,rssi_dbm,status\n';
  exportRecords.forEach(r => {
    const d = new Date(r.timestamp || Date.now());
    const dateStr = d.toISOString().split('T')[0];
    const timeStr = d.toLocaleTimeString([], { hour12: false });
    csvContent += `${d.toISOString()},${dateStr},${timeStr},${r.deviceId || deviceId},${r.voltage || 0},${r.current || 0},${r.power || 0},${r.energy || 0},${r.frequency || 50},${r.pf || 0},${r.rssi || -55},${r.status || 'ONLINE'}\n`;
  });
  return csvContent;
}

app.get('/api/devices/:deviceId/export', (req, res) => {
  const csv = generateCSV(req.params.deviceId, req.query.range);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=telemetry_${req.params.deviceId}_${req.query.range || '7d'}.csv`);
  res.send(csv);
});

app.get('/api/export', (req, res) => {
  const deviceId = req.query.deviceId || deviceState.deviceId || 'ESP32-001';
  const csv = generateCSV(deviceId, req.query.range);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=telemetry_${deviceId}_${req.query.range || '7d'}.csv`);
  res.send(csv);
});

// ==============================================================================
// 4. GOOGLE SHEETS DEDICATED REST & SYNC CONTROLLER
// ==============================================================================

// Return cached sheets data + overview metrics
app.get('/api/sheets-data', (req, res) => {
  const sampled = telemetryRecords.slice(-500);
  const totalPoints = telemetryRecords.length;
  const powers = telemetryRecords.map(r => r.power || 0);
  const voltages = telemetryRecords.map(r => r.voltage || 0);
  const currents = telemetryRecords.map(r => r.current || 0);
  const pfs = telemetryRecords.map(r => r.pf || 0).filter(p => p > 0);
  const energies = telemetryRecords.map(r => r.energy || 0);

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
    webhook_configured: Boolean(config.googleSheetWebhookUrl),
    records: sampled.map(r => ({
      timestamp: r.timestamp,
      time: new Date(r.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      iso: new Date(r.timestamp).toISOString(),
      voltage: r.voltage || 0.0,
      current: r.current || 0.0,
      power: r.power || 0.0,
      energy: r.energy || 0.0,
      frequency: r.frequency || 50.0,
      pf: r.pf || 0.0,
      status: r.status || 'ONLINE'
    }))
  });
});

// Bi-directional Data Sync: Pull records directly from Google Sheet via doGet
app.get('/api/sheets/sync', async (req, res) => {
  if (!config.googleSheetWebhookUrl) {
    return res.status(400).json({ status: 'error', message: 'Google Sheet Webhook URL not configured' });
  }

  try {
    const fetchUrl = config.googleSheetWebhookUrl + (config.googleSheetWebhookUrl.includes('?') ? '&' : '?') + 'action=read&limit=100';
    const response = await fetch(fetchUrl, { redirect: 'follow' });
    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return res.json({
        status: 'notice',
        message: 'Google Apps Script Webhook returned HTML or text.',
        raw_response: text
      });
    }

    if (data && Array.isArray(data.records) && data.records.length > 0) {
      console.log(`[Google Sheets] Synchronized ${data.records.length} records from Google Sheets DB.`);
      
      const newRecords = data.records.reverse().map((r, i) => {
        let ts = Date.now() - (data.records.length - i) * 10000;
        try {
          const parts = String(r.timestamp).split(', ');
          if (parts.length === 2) {
            const [d, m, y] = parts[0].split('/').map(Number);
            const [hh, mm, ss] = parts[1].split(':').map(Number);
            ts = new Date(y, m - 1, d, hh, mm, ss).getTime();
          }
        } catch (_) {}

        return {
          id: ts || (Date.now() - (data.records.length - i) * 10000),
          deviceId: r.device_id || 'ESP32-001',
          timestamp: ts,
          voltage: Number(r.voltage) || 0.0,
          current: Number(r.current) || 0.0,
          power: Number(r.power) || 0.0,
          energy: Number(r.energy) || 0.0,
          frequency: Number(r.frequency) || 50.0,
          pf: Number(r.pf) || 0.0,
          rssi: -55,
          uptime: 3600 + i * 10,
          status: r.status || (r.voltage > 5 ? 'ONLINE' : 'OFFLINE')
        };
      });

      telemetryRecords = newRecords;
      isDbDirty = true;
      fs.writeFile(DB_FILE, JSON.stringify(telemetryRecords, null, 2), () => {});

      return res.json({
        status: 'success',
        source: 'google_sheets_live',
        total_rows: telemetryRecords.length,
        records: telemetryRecords
      });
    }

    return res.json({ status: 'warning', message: 'No records returned from Google Sheet', data });
  } catch (err) {
    console.warn('[Google Sheets] Direct sync error:', err.message);
    return res.status(502).json({
      status: 'error',
      message: 'Failed to read from Google Sheet: ' + err.message
    });
  }
});

// ==============================================================================
// OPENROUTER AI ENGINE (openai/gpt-4o-mini) - LOAD CONDITION & COPILOT
// ==============================================================================

function getAiConfig() {
  let conf = {
    provider: process.env.AI_PROVIDER || 'openrouter',
    apiKey: process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY || '',
    model: process.env.AI_MODEL || 'openai/gpt-4o-mini'
  };
  try {
    const configPath = path.join(__dirname, 'data', 'config.json');
    if (fs.existsSync(configPath)) {
      const fileData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (fileData.aiApiKey) conf.apiKey = fileData.aiApiKey;
      if (fileData.aiModel) conf.model = fileData.aiModel;
      if (fileData.aiProvider) conf.provider = fileData.aiProvider;
    }
  } catch (e) {
    console.warn('[AI Config] Read error:', e.message);
  }
  return conf;
}

// Call OpenRouter API with fallback
async function callOpenRouter(messages, temperature = 0.4, maxTokens = 600) {
  const { apiKey, model } = getAiConfig();
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured in data/config.json or .env');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'KSRCT EEE Energy Monitor'
    },
    body: JSON.stringify({
      model: model || 'openai/gpt-4o-mini',
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('Empty response received from OpenRouter');
  }
  return text;
}

// AI Engine Configuration / Status Route
app.get('/api/ai/config', (req, res) => {
  const conf = getAiConfig();
  res.json({
    status: 'active',
    provider: conf.provider,
    model: conf.model,
    hasApiKey: !!conf.apiKey,
    engine: 'OpenRouter Industrial Power & Load Condition AI Engine',
    features: [
      'Realtime Load Condition Diagnosis (Resistive / Inductive / Distortion)',
      'Power Factor & Reactive Burden Assessment',
      'Overload & Thermal Stress Detection',
      'Voltage Sag & Swell Grid Quality Alerts',
      'Interactive Electrical Engineering Copilot'
    ]
  });
});

// Deterministic rule-based load condition evaluator (used as baseline & fallback)
function evaluateLoadConditionMetrics(data) {
  const v = Number(data.voltage) || 0;
  const i = Number(data.current) || 0;
  const p = Number(data.power) || 0;
  const pf = Number(data.pf) || 0;
  const f = Number(data.frequency) || 50.0;
  const apparentPower = Math.round(v * i * 10) / 10;
  const reactivePower = Math.round(Math.sqrt(Math.max(0, (apparentPower * apparentPower) - (p * p))) * 10) / 10;

  let condition = 'NORMAL';
  let category = 'Resistive';
  let thermalRisk = 'LOW';
  let gridStability = 'STABLE';
  let efficiencyGrade = 'A+';
  let healthScore = 95;

  if (v < 10) {
    condition = 'SENSOR DISCONNECTED';
    category = 'Offline';
    efficiencyGrade = 'N/A';
    healthScore = 0;
  } else if (p < 5 || i < 0.05) {
    condition = 'STANDBY / IDLE';
    category = 'Standby';
    efficiencyGrade = 'A';
    healthScore = 100;
  } else {
    // Determine category based on power factor and current
    if (pf >= 0.95) {
      category = 'Resistive (Heater / Incandescent / Unity PF)';
      condition = 'OPTIMAL RESISTIVE LOAD';
      efficiencyGrade = 'A+';
      healthScore = 98;
    } else if (pf >= 0.85) {
      category = 'Mixed / Mild Inductive Load';
      condition = 'HEALTHY INDUSTRIAL LOAD';
      efficiencyGrade = 'A';
      healthScore = 90;
    } else if (pf >= 0.70) {
      category = 'Inductive Load (Motor / Compressor / Choke)';
      condition = 'INDUCTIVE LOAD - MODERATE PF LOSS';
      efficiencyGrade = 'B';
      healthScore = 75;
    } else {
      category = 'Heavy Reactive / Distorted Load';
      condition = 'LOW POWER FACTOR PENALTY RISK';
      efficiencyGrade = 'C';
      healthScore = 55;
    }

    // Overload checks
    if (i > 15 || p > 3000) {
      condition = 'CRITICAL OVERLOAD DANGER';
      thermalRisk = 'HIGH';
      efficiencyGrade = 'Critical';
      healthScore = Math.min(healthScore, 30);
    } else if (i > 10 || p > 2200) {
      condition = 'HIGH LOAD WARNING';
      thermalRisk = 'MODERATE';
      efficiencyGrade = 'B';
      healthScore = Math.min(healthScore, 65);
    }

    // Voltage quality checks (Nominal: 230V ± 10% -> 207V to 253V)
    if (v < 200) {
      gridStability = 'UNDERVOLTAGE SAG';
      healthScore = Math.max(20, healthScore - 25);
    } else if (v > 250) {
      gridStability = 'OVERVOLTAGE SURGE';
      healthScore = Math.max(20, healthScore - 20);
    }

    // Frequency stability check (Nominal: 50Hz ± 0.5Hz)
    if (Math.abs(f - 50.0) > 0.5) {
      gridStability = gridStability === 'STABLE' ? 'FREQUENCY FLUCTUATION' : gridStability + ' & FREQ DRIFT';
    }
  }

  return {
    v, i, p, pf, f,
    apparentPower,
    reactivePower,
    condition,
    category,
    thermalRisk,
    gridStability,
    efficiencyGrade,
    healthScore
  };
}

// AI Analyze Load Route (OpenRouter GPT-4o-mini + Load Condition Telemetry)
app.post('/api/ai/analyze', async (req, res) => {
  const currentData = req.body?.telemetry || deviceState.latestData || {
    voltage: 230.0,
    current: 0.0,
    power: 0.0,
    frequency: 50.0,
    pf: 0.0,
    energy: 0.0
  };

  const metrics = evaluateLoadConditionMetrics(currentData);

  try {
    const systemPrompt = `You are a Principal Electrical Power Quality and Energy Auditor at KSRCT Department of EEE.
Analyze the electrical load telemetry from an ESP32 PZEM-004T monitor.
Return a STRICT JSON object only (no markdown code fence, no additional commentary) with this exact schema:
{
  "load_condition": "${metrics.condition}",
  "load_category": "Resistive | Inductive (Motors) | Heavy Reactive | Standby | Overload",
  "health_score": ${metrics.healthScore},
  "efficiency_rating": "${metrics.efficiencyGrade}",
  "thermal_risk": "${metrics.thermalRisk}",
  "grid_stability": "${metrics.gridStability}",
  "apparent_power_va": ${metrics.apparentPower},
  "reactive_power_var": ${metrics.reactivePower},
  "summary": "2-3 concise sentences diagnosing the exact load state, power factor efficiency, and load safety.",
  "load_type_detected": "Briefly describe likely connected appliances/equipment based on V, I, P, PF (e.g. Induction Motor, Resistive Heater, LED SMPS bank, etc.)",
  "recommendations": [
    "Specific engineering advice 1",
    "Specific engineering advice 2",
    "Specific engineering advice 3"
  ],
  "projected_cost_monthly_inr": 0,
  "projected_kwh_monthly": 0
}`;

    const userPrompt = `Live Telemetry Snapshot:
- Voltage: ${metrics.v} V AC (Nominal 230V)
- Current: ${metrics.i} A RMS
- Active Power: ${metrics.p} W
- Power Factor: ${metrics.pf}
- Frequency: ${metrics.f} Hz
- Apparent Power: ${metrics.apparentPower} VA
- Calculated Reactive Power: ${metrics.reactivePower} VAR
- Energy Consumed so far: ${currentData.energy || 0} kWh
- Hardware Device: ${deviceState.deviceId} (Status: ${deviceState.online ? 'Online' : 'Standby'})

Provide full electrical load diagnosis and practical energy optimization advice.`;

    const rawReply = await callOpenRouter([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], 0.2, 700);

    let parsed;
    try {
      const cleanJson = rawReply.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.warn('[AI Analyze] JSON parse warning, falling back to structured wrapper');
      parsed = {
        load_condition: metrics.condition,
        load_category: metrics.category,
        health_score: metrics.healthScore,
        efficiency_rating: metrics.efficiencyGrade,
        thermal_risk: metrics.thermalRisk,
        grid_stability: metrics.gridStability,
        apparent_power_va: metrics.apparentPower,
        reactive_power_var: metrics.reactivePower,
        summary: rawReply.slice(0, 300),
        load_type_detected: metrics.category,
        recommendations: [
          'Maintain balanced load current below rated breaker thresholds.',
          'Verify power factor correction capacitors if inductive loads are active.'
        ]
      };
    }

    // Ensure numeric projections
    const monthlyKwh = Number(((metrics.p * 24 * 30) / 1000).toFixed(2));
    const monthlyCost = Math.round(monthlyKwh * 8.5); // Approx INR 8.5 / kWh
    parsed.projected_kwh_monthly = parsed.projected_kwh_monthly || monthlyKwh;
    parsed.projected_cost_monthly_inr = parsed.projected_cost_monthly_inr || monthlyCost;

    return res.json({
      status: 'success',
      provider: 'OpenRouter (openai/gpt-4o-mini)',
      metrics,
      analysis: parsed
    });
  } catch (err) {
    console.error('[AI Analyze Error]:', err.message);
    // Return high-fidelity rule-based analysis so the dashboard never goes blank
    const monthlyKwh = Number(((metrics.p * 24 * 30) / 1000).toFixed(2));
    const monthlyCost = Math.round(monthlyKwh * 8.5);

    return res.json({
      status: 'success',
      provider: 'OpenRouter Local Fallback Engine',
      fallbackReason: err.message,
      metrics,
      analysis: {
        load_condition: metrics.condition,
        load_category: metrics.category,
        health_score: metrics.healthScore,
        efficiency_rating: metrics.efficiencyGrade,
        thermal_risk: metrics.thermalRisk,
        grid_stability: metrics.gridStability,
        apparent_power_va: metrics.apparentPower,
        reactive_power_var: metrics.reactivePower,
        summary: `Load diagnosed as ${metrics.condition} (${metrics.category}) with active draw of ${metrics.p}W at ${metrics.v}V (${metrics.pf} PF). Thermal stress is ${metrics.thermalRisk}.`,
        load_type_detected: metrics.p < 5 ? 'Zero/Standby Load' : (metrics.pf > 0.95 ? 'Resistive Load (Heater/Incandescent)' : 'Inductive / Reactive Equipment'),
        recommendations: [
          metrics.pf < 0.85 ? 'Install APFC capacitor bank to compensate inductive reactive burden.' : 'Power factor is optimal (>0.85); line losses are low.',
          metrics.v < 207 ? 'Grid voltage is sagging below 207V. Monitor motor windings for excessive temperature.' : 'Grid voltage is stable within nominal tolerances.',
          'Ensure conductors and PZEM-004T CT sensor are firmly terminated.'
        ],
        projected_kwh_monthly: monthlyKwh,
        projected_cost_monthly_inr: monthlyCost
      }
    });
  }
});

// Backward-compatible alias for /api/ai/insights
app.get('/api/ai/insights', async (req, res) => {
  req.body = { telemetry: deviceState.latestData };
  return app._router.handle({ ...req, method: 'POST', url: '/api/ai/analyze' }, res);
});

// Interactive AI Copilot Chat Route (OpenRouter GPT-4o-mini)
app.post('/api/ai/chat', async (req, res) => {
  const userMsg = (req.body && req.body.message) || '';
  if (!userMsg.trim()) {
    return res.status(400).json({ status: 'error', message: 'Message cannot be empty.' });
  }

  const latest = deviceState.latestData || {
    voltage: 230.0,
    current: 0.0,
    power: 0.0,
    frequency: 50.0,
    pf: 0.0,
    energy: 0.0
  };

  const metrics = evaluateLoadConditionMetrics(latest);
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-8) : [];

  const systemPrompt = `You are the KSRCT EEE Smart Energy AI Copilot & Electrical Load Diagnostic Specialist.
You have real-time direct access to the live ESP32 PZEM-004T telemetry stream.
You must understand and explain the EXACT CONDITION OF THE LOAD, power factor, reactive power, electrical safety, energy efficiency, and hardware health.

LIVE ELECTRICAL TELEMETRY SNAPSHOT:
- Hardware Device: ${deviceState.deviceId} (Status: ${deviceState.online ? 'ONLINE' : 'STANDBY/OFFLINE'})
- Voltage: ${metrics.v} V AC (Nominal 230V, Grid Quality: ${metrics.gridStability})
- Current: ${metrics.i} A RMS (Thermal Risk: ${metrics.thermalRisk})
- Active Power: ${metrics.p} W
- Power Factor: ${metrics.pf} (${metrics.category})
- Frequency: ${metrics.f} Hz (Nominal 50.0 Hz)
- Apparent Power: ${metrics.apparentPower} VA
- Reactive Power: ${metrics.reactivePower} VAR
- Total Energy Consumed: ${latest.energy || 0} kWh
- Diagnosed Load Condition: ${metrics.condition}
- Load Health Score: ${metrics.healthScore}/100 (Grade: ${metrics.efficiencyGrade})

INSTRUCTIONS:
1. Always reference the LIVE load condition and exact telemetry values when the user asks about the load, status, power, energy, or faults.
2. Provide clear, professional electrical engineering insights (explain whether the load is resistive, inductive motor load, standby, or overload).
3. Give practical advice for power factor improvement, load balancing, safety, and tariff reduction.
4. Keep answers concise, clear, and easy to read with bullet points when relevant.
5. If the user asks about creators: Web developed by Prasanna, HarishKumar, Rahul; Hardware by Viswanath; Product by Pavinkumar; Dept of EEE - KSRCT.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: String(h.content || '')
    })),
    { role: 'user', content: userMsg }
  ];

  try {
    const reply = await callOpenRouter(messages, 0.4, 650);
    return res.json({
      status: 'success',
      provider: 'OpenRouter (openai/gpt-4o-mini)',
      reply,
      snapshot: {
        voltage: metrics.v,
        current: metrics.i,
        power: metrics.p,
        pf: metrics.pf,
        condition: metrics.condition,
        category: metrics.category,
        health_score: metrics.healthScore,
        deviceId: deviceState.deviceId
      }
    });
  } catch (err) {
    console.error('[AI Chat Error]:', err.message);
    // Intelligent local fallback response
    let fallbackReply = `⚡ **[AI Diagnostic Copilot]**\n\n`;
    fallbackReply += `Current Live Load Condition: **${metrics.condition}**\n`;
    fallbackReply += `• **Active Power:** ${metrics.p} W | **Voltage:** ${metrics.v} V AC\n`;
    fallbackReply += `• **Current:** ${metrics.i} A | **Power Factor:** ${metrics.pf} (${metrics.category})\n`;
    fallbackReply += `• **Load Health Score:** ${metrics.healthScore}/100 (${metrics.efficiencyGrade})\n\n`;

    if (metrics.p < 5) {
      fallbackReply += `Your monitored circuit is currently in **Standby or Zero Load** mode. Connect an electrical load to observe real-time dynamic waveforms and power draw.`;
    } else if (metrics.pf < 0.85) {
      fallbackReply += `Your circuit is drawing **inductive reactive power** (${metrics.reactivePower} VAR). Consider shunt capacitance to improve the power factor above 0.90.`;
    } else {
      fallbackReply += `The connected load is operating efficiently with unity/near-unity power factor and stable grid voltage.`;
    }

    return res.json({
      status: 'success',
      provider: 'OpenRouter Local Fallback',
      fallbackNotice: err.message,
      reply: fallbackReply,
      snapshot: {
        voltage: metrics.v,
        current: metrics.i,
        power: metrics.p,
        pf: metrics.pf,
        condition: metrics.condition,
        category: metrics.category,
        health_score: metrics.healthScore,
        deviceId: deviceState.deviceId
      }
    });
  }
});


// Manual Snapshot Trigger: Log current state immediately to Google Sheets
app.post('/api/sheets/log-now', async (req, res) => {
  const record = deviceState.latestData || {
    timestamp: Date.now(),
    deviceId: deviceState.deviceId,
    voltage: 0.0,
    current: 0.0,
    power: 0.0,
    energy: 0.0,
    frequency: 0.0,
    pf: 0.0,
    status: deviceState.online ? 'ONLINE' : 'MANUAL_SNAPSHOT'
  };

  const result = await postToGoogleSheets(record, true);
  if (result.success) {
    res.json({ status: 'success', message: 'Snapshot successfully logged to Google Sheets!', details: result });
  } else {
    res.status(502).json({ status: 'error', message: 'Failed to log snapshot to Google Sheets', details: result });
  }
});

// Test Webhook Connection
app.post('/api/sheets/test', async (req, res) => {
  const targetUrl = req.body.webhook_url || config.googleSheetWebhookUrl;
  if (!targetUrl) {
    return res.status(400).json({ status: 'error', message: 'No webhook URL provided' });
  }

  const startTime = Date.now();
  try {
    const pingUrl = targetUrl + (targetUrl.includes('?') ? '&' : '?') + 'action=ping';
    const response = await fetch(pingUrl);
    const latencyMs = Date.now() - startTime;
    const text = await response.text();

    res.json({
      status: 'success',
      latency_ms: latencyMs,
      http_status: response.status,
      response: text
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
      latency_ms: Date.now() - startTime
    });
  }
});

// Get/Set Sheet Configuration
app.get('/api/sheets/config', (req, res) => {
  res.json({
    webhook_url: config.googleSheetWebhookUrl,
    embed_url: config.googleSheetEmbedUrl,
    log_interval_seconds: config.sheetLogIntervalMs / 1000
  });
});

app.post('/api/sheets/config', (req, res) => {
  const { webhook_url, embed_url, log_interval_seconds } = req.body;
  if (webhook_url) config.googleSheetWebhookUrl = webhook_url;
  if (embed_url) config.googleSheetEmbedUrl = embed_url;
  if (log_interval_seconds && Number(log_interval_seconds) >= 5) {
    config.sheetLogIntervalMs = Number(log_interval_seconds) * 1000;
  }

  console.log('[Config] Updated Google Sheets configuration.');
  res.json({
    status: 'success',
    message: 'Configuration updated successfully',
    config: {
      webhook_url: config.googleSheetWebhookUrl,
      embed_url: config.googleSheetEmbedUrl,
      log_interval_seconds: config.sheetLogIntervalMs / 1000
    }
  });
});

// Fallback to studio index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[PulseIoT] Industrial Telemetry Server running on http://localhost:${PORT}`);
  console.log(`[PulseIoT] Google Sheets Webhook configured: ${config.googleSheetWebhookUrl ? 'YES' : 'NO'}`);
});

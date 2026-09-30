// scripts/run_diagnostics.js - Comprehensive 13-Point System & Data Validation
const fetch = globalThis.fetch || require('node-fetch');
const WebSocket = require('ws');

async function runFullDiagnostics() {
  const tests = [];
  const logTest = (name, passed, detail) => {
    tests.push({ name, passed, detail });
    console.log((passed ? '✅ [PASS] ' : '❌ [FAIL] ') + name + ': ' + JSON.stringify(detail));
  };

  // 1. Health Endpoint
  try {
    const res = await fetch('http://localhost:3000/health');
    const data = await res.json();
    logTest('Server Health Check', res.ok && data.status === 'healthy', { status: res.status, cached: data.cached_records });
  } catch (e) { logTest('Server Health Check', false, e.message); }

  // 2. Devices Summary API
  try {
    const res = await fetch('http://localhost:3000/api/devices');
    const data = await res.json();
    logTest('Devices Summary API', res.ok && Array.isArray(data) && data.length > 0, { deviceId: data[0]?.device_id, status: data[0]?.status });
  } catch (e) { logTest('Devices Summary API', false, e.message); }

  // 3. Telemetry Ingestion (ESP32 POST)
  try {
    const payload = {
      device_id: 'ESP32-001',
      voltage: 238.4,
      current: 2.95,
      power: 703.2,
      energy: 0.1850,
      frequency: 50.0,
      pf: 0.98,
      rssi: -52,
      uptime: 5600
    };
    const res = await fetch('http://localhost:3000/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    logTest('Telemetry Ingestion (POST /api/telemetry)', res.ok && data.status === 'success', data);
  } catch (e) { logTest('Telemetry Ingestion (POST /api/telemetry)', false, e.message); }

  // 4. Latest Telemetry Query
  try {
    const res = await fetch('http://localhost:3000/api/devices/ESP32-001/latest');
    const data = await res.json();
    const v = data.telemetry?.voltage;
    logTest('Device Latest Telemetry API', res.ok && typeof v === 'number', { status: data.status, voltage: v, power: data.telemetry?.power });
  } catch (e) { logTest('Device Latest Telemetry API', false, e.message); }

  // 5. Sliding 50 Window Telemetry Table API
  try {
    const res = await fetch('http://localhost:3000/api/telemetry/recent?deviceId=ESP32-001');
    const data = await res.json();
    logTest('Sliding 50 Telemetry Table API', res.ok && data.records && data.records.length > 0, {
      count: data.count,
      latest_voltage: data.records[0] ? data.records[0].voltage : null
    });
  } catch (e) { logTest('Sliding 50 Telemetry Table API', false, e.message); }

  // 6. Multi-Graph 100-Point History API
  try {
    const channels = ['voltage', 'current', 'power', 'frequency'];
    let allGood = true;
    for (const ch of channels) {
      const res = await fetch(`http://localhost:3000/api/devices/ESP32-001/history?channel=${ch}&range=7d`);
      const data = await res.json();
      if (!res.ok || !data.data) allGood = false;
    }
    logTest('Multi-Graph History API (all 4 channels)', allGood, { channels });
  } catch (e) { logTest('Multi-Graph History API (all 4 channels)', false, e.message); }

  // 7. Dynamic Statistics API
  try {
    const res = await fetch('http://localhost:3000/api/devices/ESP32-001/statistics?channel=power&range=7d');
    const data = await res.json();
    logTest('Statistics Analytics Engine', res.ok && typeof data.avg === 'number' && data.max > 0, { current: data.current, max: data.max, avg: data.avg });
  } catch (e) { logTest('Statistics Analytics Engine', false, e.message); }

  // 8. Full Cloud CSV Export (range=all)
  try {
    const res = await fetch('http://localhost:3000/api/export?range=all');
    const text = await res.text();
    const rows = text.trim().split('\n');
    logTest('Full CSV Export (range=all)', res.ok && rows.length >= 2, { header: rows[0], row_count: rows.length - 1 });
  } catch (e) { logTest('Full CSV Export (range=all)', false, e.message); }

  // 9. Google Sheets Webhook Log (Push to Sheet)
  try {
    const res = await fetch('http://localhost:3000/api/sheets/log-now', { method: 'POST' });
    const data = await res.json();
    logTest('Google Sheets Push to Row 2', res.ok && data.status === 'success', {
      latencyMs: data.details?.latencyMs,
      response: data.details?.response
    });
  } catch (e) { logTest('Google Sheets Push to Row 2', false, e.message); }

  // 10. Google Sheets Sync from Cloud (Pull from Sheet)
  try {
    const res = await fetch('http://localhost:3000/api/sheets/sync');
    const data = await res.json();
    logTest('Google Sheets Pull Sync', res.ok && (data.status === 'success' || data.records), {
      status: data.status,
      total_rows: data.total_rows || data.records?.length
    });
  } catch (e) { logTest('Google Sheets Pull Sync', false, e.message); }

  // 11. WebSocket Live Stream Broadcast
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:3000/ws');
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS timeout')); }, 4000);
      ws.on('open', () => {
        logTest('WebSocket Telemetry Stream Connection', true, 'Connected to ws://localhost:3000/ws');
        clearTimeout(timer);
        ws.close();
        resolve();
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  } catch (e) { logTest('WebSocket Telemetry Stream Connection', false, e.message); }

  // 12. Frontend Studio (:3000)
  try {
    const res = await fetch('http://localhost:3000/');
    logTest('Web Studio Frontend (:3000)', res.ok && res.status === 200, { status: res.status });
  } catch (e) { logTest('Web Studio Frontend (:3000)', false, e.message); }

  // 13. React Vite App (:5173)
  try {
    const res = await fetch('http://localhost:5173/');
    logTest('React Vite Application (:5173)', res.ok && res.status === 200, { status: res.status });
  } catch (e) { logTest('React Vite Application (:5173)', false, e.message); }

  console.log('\n--- DIAGNOSTICS SUMMARY ---');
  const passCount = tests.filter(t => t.passed).length;
  console.log(`PASSED: ${passCount} / ${tests.length} tests`);
  return passCount === tests.length;
}

runFullDiagnostics().then(ok => process.exit(ok ? 0 : 1));

// seed_data.js - Restore / Seed historical telemetry records into Google Sheets
const fs = require('fs');
const path = require('path');

const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbxwqlBZPsX6Mi0iyJWtiwra6S_pWYUDzfmpeoekIyOQU1c8HkBxVuj5BZvBI0h5YfEv1Q/exec';
const DB_FILE = path.join(__dirname, 'telemetry.json');

async function seedData() {
  if (!fs.existsSync(DB_FILE)) {
    console.error('telemetry.json not found!');
    return;
  }

  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const records = JSON.parse(raw);
  console.log(`Found ${records.length} records in telemetry.json.`);

  // Upload recent 50 records to Google Sheet
  const sample = records.slice(-50);
  console.log(`Uploading ${sample.length} records to Google Sheets...`);

  for (let i = 0; i < sample.length; i++) {
    const r = sample[i];
    const payload = {
      timestamp: new Date(r.timestamp).toISOString(),
      device_id: r.deviceId || 'ESP32-001',
      voltage: r.voltage || 244.0,
      current: r.current || 0.0,
      power: r.power || 0.0,
      energy: r.energy || 4.12,
      frequency: r.frequency || 50.0,
      pf: r.pf || 0.99,
      status: 'ONLINE'
    };

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      console.log(`[${i + 1}/${sample.length}] Logged: V=${payload.voltage}V, Status=${data.result}`);
    } catch (e) {
      console.warn(`Error on row ${i + 1}:`, e.message);
    }

    // Delay 300ms between rows
    await new Promise(res => setTimeout(res, 300));
  }

  console.log('Finished seeding records! Refresh your Google Sheet.');
}

seedData();

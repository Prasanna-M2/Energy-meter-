/**
 * ==============================================================================
 * Google Apps Script for ESP32 Real-Time Energy Monitor & Data Sharing API
 * ==============================================================================
 * 
 * FEATURES:
 * 1. Data Ingestion (doPost):
 *    - Strict numeric validation (preserves real 0.0 readings without false fallbacks)
 *    - Automatic Header initialization and frozen row formatting
 *    - Records: Timestamp, Device ID, Voltage, Current, Power, Energy, Frequency, PF, Status
 * 2. Bi-directional Data Sharing (doGet):
 *    - ?action=read : Returns last N records (default 100) as JSON
 *    - ?action=latest : Returns the single most recent telemetry record
 *    - ?action=stats : Returns aggregated statistics (total records, peak power, total energy)
 *    - ?action=ping : Verifies webhook connectivity and health
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your Google Sheet (or create one at https://sheets.new)
 * 2. Go to: Extensions > Apps Script
 * 3. Delete any existing code and PASTE this complete script
 * 4. Click 'Save' (disk icon)
 * 5. Click 'Deploy' > 'New deployment'
 *    - Select type: 'Web app'
 *    - Description: 'PulseIoT Energy Telemetry Webhook v2'
 *    - Execute as: 'Me'
 *    - Who has access: 'Anyone' (IMPORTANT: Must be 'Anyone')
 * 6. Click 'Deploy', authorize permissions if prompted, and copy the Web App URL.
 * 7. In your Google Sheet, click 'Share' (top-right) -> General access -> 'Anyone with the link can view'
 *    (This allows the embedded dashboard iframe to render without 401 Unauthorized errors!)
 * ==============================================================================
 */

var HEADERS = [
  "Timestamp",
  "Device ID",
  "Voltage (V)",
  "Current (A)",
  "Power (W)",
  "Energy (kWh)",
  "Frequency (Hz)",
  "Power Factor",
  "Status"
];

// Helper: Ensure the active sheet has proper headers and structure
function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#1e293b");
    headerRange.setFontColor("#38bdf8");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ------------------------------------------------------------------------------
// POST: Ingest telemetry from ESP32 or Cloud Server
// ------------------------------------------------------------------------------
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ result: "error", message: "Empty POST body received" }, 400);
    }

    var sheet = getOrCreateSheet();
    var data = JSON.parse(e.postData.contents);

    var now = new Date();
    var timestamp = data.timestamp ? new Date(data.timestamp).toISOString() : now.toISOString();
    var deviceId = data.device_id || data.deviceId || "ESP32-001";

    // Strict numeric extraction - never turn a legitimate 0.0 into 50 or 1.0!
    var voltage   = (data.voltage !== undefined && data.voltage !== null && !isNaN(Number(data.voltage))) ? Number(data.voltage) : 0.0;
    var current   = (data.current !== undefined && data.current !== null && !isNaN(Number(data.current))) ? Number(data.current) : 0.0;
    var power     = (data.power !== undefined && data.power !== null && !isNaN(Number(data.power))) ? Number(data.power) : 0.0;
    var energy    = (data.energy !== undefined && data.energy !== null && !isNaN(Number(data.energy))) ? Number(data.energy) : 0.0;
    var frequency = (data.frequency !== undefined && data.frequency !== null && !isNaN(Number(data.frequency))) ? Number(data.frequency) : 0.0;
    var pf        = (data.pf !== undefined && data.pf !== null && !isNaN(Number(data.pf))) ? Number(data.pf) : 0.0;
    var status    = data.status || (voltage > 5.0 ? "ONLINE" : "DISCONNECTED");

    // Append new row
    sheet.appendRow([
      timestamp,
      deviceId,
      voltage,
      current,
      power,
      energy,
      frequency,
      pf,
      status
    ]);

    return jsonResponse({
      result: "success",
      message: "Telemetry logged successfully",
      timestamp: timestamp,
      row: sheet.getLastRow(),
      recorded: {
        device_id: deviceId,
        voltage: voltage,
        current: current,
        power: power,
        energy: energy,
        frequency: frequency,
        pf: pf,
        status: status
      }
    });

  } catch (error) {
    return jsonResponse({ result: "error", message: error.toString() });
  }
}

// ------------------------------------------------------------------------------
// GET: Bi-directional Data Sharing & Telemetry Retrieval API
// ------------------------------------------------------------------------------
function doGet(e) {
  try {
    var sheet = getOrCreateSheet();
    var params = (e && e.parameter) ? e.parameter : {};
    var action = (params.action || "read").toLowerCase();

    // 1. Connectivity Ping Action
    if (action === "ping") {
      return jsonResponse({
        result: "success",
        message: "PulseIoT ESP32 Energy Monitor Webhook is Active & Ready!",
        spreadsheet_name: SpreadsheetApp.getActiveSpreadsheet().getName(),
        total_rows: sheet.getLastRow(),
        timestamp: new Date().toISOString()
      });
    }

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return jsonResponse({
        result: "success",
        total_records: 0,
        records: [],
        message: "No data rows logged yet"
      });
    }

    var limit = params.limit ? Math.min(parseInt(params.limit, 10), 1000) : 100;
    var startRow = Math.max(2, lastRow - limit + 1);
    var numRows = lastRow - startRow + 1;

    var rangeData = sheet.getRange(startRow, 1, numRows, HEADERS.length).getValues();
    var records = [];

    for (var i = 0; i < rangeData.length; i++) {
      var row = rangeData[i];
      records.push({
        timestamp: row[0],
        device_id: row[1],
        voltage: Number(row[2]) || 0.0,
        current: Number(row[3]) || 0.0,
        power: Number(row[4]) || 0.0,
        energy: Number(row[5]) || 0.0,
        frequency: Number(row[6]) || 0.0,
        pf: Number(row[7]) || 0.0,
        status: String(row[8] || "")
      });
    }

    // 2. Latest Telemetry Action
    if (action === "latest") {
      var latest = records.length > 0 ? records[records.length - 1] : null;
      return jsonResponse({
        result: "success",
        telemetry: latest
      });
    }

    // 3. Aggregate Statistics Action
    if (action === "stats") {
      var powers = records.map(function(r) { return r.power; });
      var energies = records.map(function(r) { return r.energy; });
      var peakPower = powers.length > 0 ? Math.max.apply(null, powers) : 0.0;
      var latestEnergy = energies.length > 0 ? energies[energies.length - 1] : 0.0;

      return jsonResponse({
        result: "success",
        total_records: lastRow - 1,
        sampled_records: records.length,
        peak_power_w: peakPower,
        latest_energy_kwh: latestEnergy
      });
    }

    // 4. Default: Return Records (Data Sharing)
    return jsonResponse({
      result: "success",
      total_records: lastRow - 1,
      count: records.length,
      records: records
    });

  } catch (error) {
    return jsonResponse({ result: "error", message: error.toString() });
  }
}

// Helper: Format JSON response with proper CORS headers
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

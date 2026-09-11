/**
 * ==============================================================================
 * ESP32 Real-Time Energy Monitor - Google Apps Script Webhook (Top-Row Ingestion)
 * ==============================================================================
 * Features:
 * 1. Inserts new readings directly at ROW 2 (Top of sheet, right under the headers):
 *    - Newest readings are immediately visible without scrolling down thousands of rows!
 * 2. Matches exact spreadsheet column layout:
 *    Col A: Timestamp | Col B: Voltage (V) | Col C: Current (A) | Col D: Power (W)
 *    Col E: Energy (kWh) | Col F: Frequency (Hz) | Col G: Power Factor | Col H: Device ID | Col I: Status
 * 3. Bi-directional API: logs via POST, reads/shares records via GET
 * 4. Automatic cleanup endpoint (?action=cleanup) to remove old blank rows
 * ==============================================================================
 */

var HEADERS = [
  "Timestamp",
  "Voltage (V)",
  "Current (A)",
  "Power (W)",
  "Energy (kWh)",
  "Frequency (Hz)",
  "Power Factor",
  "Device ID",
  "Status"
];

function getTargetSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Sheet1") || ss.getActiveSheet();

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
// POST: Ingest Telemetry and Insert at Row 2 (Top of Sheet)
// ------------------------------------------------------------------------------
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({
        "result": "error",
        "message": "Empty POST body received"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var sheet = getTargetSheet();
    var data = JSON.parse(e.postData.contents);

    var now = new Date();
    var timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : now.toLocaleString();
    var deviceId  = data.device_id || data.deviceId || "ESP32-001";

    var voltage   = (data.voltage !== undefined && data.voltage !== null && !isNaN(Number(data.voltage))) ? Number(data.voltage) : 0.0;
    var current   = (data.current !== undefined && data.current !== null && !isNaN(Number(data.current))) ? Number(data.current) : 0.0;
    var power     = (data.power !== undefined && data.power !== null && !isNaN(Number(data.power))) ? Number(data.power) : 0.0;
    var energy    = (data.energy !== undefined && data.energy !== null && !isNaN(Number(data.energy))) ? Number(data.energy) : 0.0;
    var frequency = (data.frequency !== undefined && data.frequency !== null && !isNaN(Number(data.frequency))) ? Number(data.frequency) : 0.0;
    var pf        = (data.pf !== undefined && data.pf !== null && !isNaN(Number(data.pf))) ? Number(data.pf) : 0.0;
    var status    = data.status || (voltage > 5.0 ? "ONLINE" : "DISCONNECTED");

    // Exact Column Order matching the Google Sheet:
    // A: Timestamp | B: Voltage | C: Current | D: Power | E: Energy | F: Freq | G: PF | H: Device ID | I: Status
    var newRow = [
      timestamp,
      voltage,
      current,
      power,
      energy,
      frequency,
      pf,
      deviceId,
      status
    ];

    // Insert directly at Row 2 so it is immediately visible at the top!
    sheet.insertRowAfter(1);
    sheet.getRange(2, 1, 1, newRow.length).setValues([newRow]);

    return ContentService.createTextOutput(JSON.stringify({
      "result": "success",
      "message": "Telemetry logged at Row 2",
      "row": 2,
      "recorded": {
        "timestamp": timestamp,
        "voltage": voltage,
        "current": current,
        "power": power,
        "energy": energy,
        "frequency": frequency,
        "pf": pf,
        "device_id": deviceId,
        "status": status
      }
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      "result": "error",
      "message": error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ------------------------------------------------------------------------------
// GET: Read Data & Cleanup API
// ------------------------------------------------------------------------------
function doGet(e) {
  try {
    var sheet = getTargetSheet();
    var params = (e && e.parameter) ? e.parameter : {};
    var action = (params.action || "ping").toLowerCase();

    // 1. Webhook Ping Health Check
    if (action === "ping") {
      return ContentService.createTextOutput(JSON.stringify({
        "result": "success",
        "message": "PulseIoT ESP32 Google Sheet Webhook is Active!",
        "total_rows": sheet.getLastRow(),
        "timestamp": new Date().toISOString()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. Clean up old/empty rows in bulk
    if (action === "cleanup") {
      var lastRow = sheet.getLastRow();
      if (lastRow > 2) {
        sheet.deleteRows(3, lastRow - 2);
      }
      return ContentService.createTextOutput(JSON.stringify({
        "result": "success",
        "message": "Old rows cleaned up! All new readings will appear starting at Row 2."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify({
        "result": "success",
        "total_records": 0,
        "records": []
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var limit = params.limit ? Math.min(parseInt(params.limit, 10), 100) : 50;
    var numRows = Math.min(lastRow - 1, limit);

    // Read top N rows (starting from Row 2 down)
    var rangeData = sheet.getRange(2, 1, numRows, HEADERS.length).getValues();
    var records = [];

    for (var i = 0; i < rangeData.length; i++) {
      var row = rangeData[i];
      if (!row[0] && !row[1] && !row[7]) continue; // Skip completely blank lines
      records.push({
        timestamp: row[0],
        voltage: Number(row[1]) || 0.0,
        current: Number(row[2]) || 0.0,
        power: Number(row[3]) || 0.0,
        energy: Number(row[4]) || 0.0,
        frequency: Number(row[5]) || 0.0,
        pf: Number(row[6]) || 0.0,
        device_id: String(row[7] || ""),
        status: String(row[8] || "")
      });
    }

    return ContentService.createTextOutput(JSON.stringify({
      "result": "success",
      "total_records": lastRow - 1,
      "records": records
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      "result": "error",
      "message": error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

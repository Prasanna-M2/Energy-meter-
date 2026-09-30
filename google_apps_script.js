/**
 * ==============================================================================
 * ESP32 REAL-TIME TELEMETRY & DATA ANALYSIS - GOOGLE APPS SCRIPT WEBHOOK
 * ==============================================================================
 * Clean, professional, and streamlined Google Sheet system containing ONLY:
 * 1. Telemetry Log (Structured clean row data)
 * 2. Data Analysis (Summary metrics & high-resolution trend charts)
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
  var sheet = ss.getSheetByName("Telemetry Log");
  
  if (!sheet) {
    var firstSheet = ss.getSheets()[0];
    if (firstSheet && (firstSheet.getName() === "Sheet1" || firstSheet.getName() === "Sheet 1")) {
      firstSheet.setName("Telemetry Log");
      sheet = firstSheet;
    } else {
      sheet = ss.insertSheet("Telemetry Log", 0);
    }
  }

  // Format headers if empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#1e293b"); // Modern Professional Slate Header
    headerRange.setFontColor("#ffffff"); // Crisp White Header Text
    headerRange.setHorizontalAlignment("center");
    headerRange.setVerticalAlignment("middle");
    headerRange.setFontSize(11);
    sheet.setFrozenRows(1);
    sheet.setRowHeight(1, 38);
    sheet.setColumnWidth(1, 175); // Ensure Timestamp fits comfortably
    sheet.setColumnWidth(8, 120); // Device ID
    sheet.setColumnWidth(9, 140); // Status
  }

  return sheet;
}

// ------------------------------------------------------------------------------
// POST: Ingest Telemetry at Row 2 (Clean Light Professional Styling)
// ------------------------------------------------------------------------------
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({
        "result": "error",
        "message": "Empty payload received"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var sheet = getTargetSheet();
    var data = JSON.parse(e.postData.contents);

    // If reformat action requested via POST
    if (data.action === "format" || data.action === "reformat") {
      formatCleanTheme(sheet);
      return ContentService.createTextOutput(JSON.stringify({
        "result": "success",
        "message": "Entire sheet reformatted to clean light theme"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var now = new Date();
    var timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : now.toLocaleString();
    var deviceId  = data.device_id || data.deviceId || "ESP32-001";

    var voltage   = Number(data.voltage) || 0.0;
    var current   = Number(data.current) || 0.0;
    var power     = Number(data.power) || 0.0;
    var energy    = Number(data.energy) || 0.0;
    var frequency = Number(data.frequency) || 0.0;
    var pf        = Number(data.pf) || 0.0;
    var status    = data.status || (voltage > 5.0 ? "ONLINE" : "DISCONNECTED");

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

    sheet.insertRowAfter(1);
    var targetRange = sheet.getRange(2, 1, 1, newRow.length);
    targetRange.setValues([newRow]);
    
    // Explicit Clean Light Colors: Crisp White background with Dark Charcoal text
    targetRange.setBackground("#ffffff");
    targetRange.setFontColor("#0f172a");
    targetRange.setFontWeight("normal");
    targetRange.setFontSize(10);
    targetRange.setHorizontalAlignment("center");
    targetRange.setVerticalAlignment("middle");
    targetRange.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
    
    // Clean Number Formatting with Units
    sheet.getRange(2, 2).setNumberFormat("0.0 \"V\"");
    sheet.getRange(2, 3).setNumberFormat("0.00 \"A\"");
    sheet.getRange(2, 4).setNumberFormat("0.0 \"W\"");
    sheet.getRange(2, 5).setNumberFormat("0.0000 \"kWh\"");
    sheet.getRange(2, 6).setNumberFormat("0.0 \"Hz\"");
    sheet.getRange(2, 7).setNumberFormat("0.00");

    // Color-Coded Status Badge
    var statusCell = sheet.getRange(2, 9);
    statusCell.setFontWeight("bold");
    if (status.indexOf("ONLINE") !== -1) {
      statusCell.setBackground("#dcfce7"); // Soft Emerald Green
      statusCell.setFontColor("#15803d"); // Dark Green
    } else if (status.indexOf("OFFLINE") !== -1) {
      statusCell.setBackground("#fee2e2"); // Soft Rose Red
      statusCell.setFontColor("#b91c1c"); // Dark Red
    } else if (status.indexOf("SNAPSHOT") !== -1) {
      statusCell.setBackground("#e0f2fe"); // Soft Sky Blue
      statusCell.setFontColor("#0369a1"); // Dark Blue
    } else {
      statusCell.setBackground("#fef3c7"); // Soft Amber Yellow
      statusCell.setFontColor("#b45309"); // Dark Amber
    }

    return ContentService.createTextOutput(JSON.stringify({
      "result": "success",
      "message": "Telemetry logged cleanly to Telemetry Log tab",
      "recorded": {
        "timestamp": timestamp,
        "voltage": voltage,
        "current": current,
        "power": power,
        "energy": energy,
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
// GET: Query Telemetry Data
// ------------------------------------------------------------------------------
function doGet(e) {
  try {
    var sheet = getTargetSheet();
    var params = (e && e.parameter) ? e.parameter : {};
    var action = (params.action || "ping").toLowerCase();

    if (action === "format" || action === "reformat") {
      formatCleanTheme(sheet);
      return ContentService.createTextOutput(JSON.stringify({
        "result": "success",
        "message": "Telemetry Log sheet reformatted to clean light professional theme!",
        "rows_formatted": sheet.getLastRow()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "ping") {
      return ContentService.createTextOutput(JSON.stringify({
        "result": "success",
        "system": "ESP32 Energy Monitor - Clean Telemetry Engine",
        "sheet_name": sheet.getName(),
        "total_rows": sheet.getLastRow(),
        "timestamp": new Date().toISOString()
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

    var rangeData = sheet.getRange(2, 1, numRows, HEADERS.length).getValues();
    var records = [];

    for (var i = 0; i < rangeData.length; i++) {
      var row = rangeData[i];
      if (!row[0] && !row[1]) continue;
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

// ------------------------------------------------------------------------------
// Custom UI Menu: One-Click Analysis Setup
// ------------------------------------------------------------------------------
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("⚡ Telemetry Menu")
    .addItem("🎨 Apply Clean Light Color Theme", "formatCleanThemeMenu")
    .addItem("📊 Build Data Analysis Dashboard", "buildAnalysisDashboard")
    .addToUi();
}

function formatCleanThemeMenu() {
  var sheet = getTargetSheet();
  formatCleanTheme(sheet);
  SpreadsheetApp.getUi().alert("✨ Clean Light Theme applied successfully!");
}

function formatCleanTheme(sheet) {
  if (!sheet) sheet = getTargetSheet();
  var lastRow = sheet.getLastRow();
  
  // 1. Format Header (Row 1)
  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setBackground("#1e293b"); // Deep Slate Navy Header
  headerRange.setFontColor("#ffffff"); // Crisp White Header Text
  headerRange.setFontWeight("bold");
  headerRange.setFontSize(11);
  headerRange.setHorizontalAlignment("center");
  headerRange.setVerticalAlignment("middle");
  sheet.setRowHeight(1, 38);
  sheet.setFrozenRows(1);
  
  if (lastRow > 1) {
    // 2. Format all data rows (Row 2 to lastRow)
    var numRows = lastRow - 1;
    var dataRange = sheet.getRange(2, 1, numRows, HEADERS.length);
    
    // Clean White background with clear dark charcoal font
    dataRange.setBackground("#ffffff");
    dataRange.setFontColor("#0f172a");
    dataRange.setFontWeight("normal");
    dataRange.setFontSize(10);
    dataRange.setHorizontalAlignment("center");
    dataRange.setVerticalAlignment("middle");
    dataRange.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
    
    // Clean Number formatting with units
    sheet.getRange(2, 2, numRows, 1).setNumberFormat("0.0 \"V\"");
    sheet.getRange(2, 3, numRows, 1).setNumberFormat("0.00 \"A\"");
    sheet.getRange(2, 4, numRows, 1).setNumberFormat("0.0 \"W\"");
    sheet.getRange(2, 5, numRows, 1).setNumberFormat("0.0000 \"kWh\"");
    sheet.getRange(2, 6, numRows, 1).setNumberFormat("0.0 \"Hz\"");
    sheet.getRange(2, 7, numRows, 1).setNumberFormat("0.00");
    
    // Color-code the Status column (Column 9) for every row
    var statusValues = sheet.getRange(2, 9, numRows, 1).getValues();
    for (var i = 0; i < statusValues.length; i++) {
      var cell = sheet.getRange(2 + i, 9);
      var status = String(statusValues[i][0] || "").toUpperCase();
      cell.setFontWeight("bold");
      if (status.indexOf("ONLINE") !== -1) {
        cell.setBackground("#dcfce7"); // Soft Emerald Green
        cell.setFontColor("#15803d"); // Dark Green
      } else if (status.indexOf("OFFLINE") !== -1) {
        cell.setBackground("#fee2e2"); // Soft Rose Red
        cell.setFontColor("#b91c1c"); // Dark Red
      } else if (status.indexOf("SNAPSHOT") !== -1) {
        cell.setBackground("#e0f2fe"); // Soft Sky Blue
        cell.setFontColor("#0369a1"); // Dark Blue
      } else {
        cell.setBackground("#fef3c7"); // Soft Amber Yellow
        cell.setFontColor("#b45309"); // Dark Amber
      }
    }
  }

  // Proper column widths so nothing is truncated
  sheet.setColumnWidth(1, 180); // Timestamp
  sheet.setColumnWidth(2, 100); // Voltage
  sheet.setColumnWidth(3, 100); // Current
  sheet.setColumnWidth(4, 110); // Power
  sheet.setColumnWidth(5, 120); // Energy
  sheet.setColumnWidth(6, 110); // Frequency
  sheet.setColumnWidth(7, 100); // PF
  sheet.setColumnWidth(8, 120); // Device ID
  sheet.setColumnWidth(9, 140); // Status
}

function buildAnalysisDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = getTargetSheet();
  var analyticsSheet = ss.getSheetByName("Data Analysis");

  if (!analyticsSheet) {
    analyticsSheet = ss.insertSheet("Data Analysis", 1);
  } else {
    analyticsSheet.clear();
  }

  // Header Title
  analyticsSheet.getRange("A1:H1").merge()
    .setValue("⚡ ESP32 TELEMETRY & ENERGY DATA ANALYSIS")
    .setFontWeight("bold")
    .setFontSize(14)
    .setBackground("#0f172a")
    .setFontColor("#38bdf8")
    .setHorizontalAlignment("center");

  // Summary Metrics Formulas
  analyticsSheet.getRange("A3").setValue("Peak Power Draw:").setFontWeight("bold");
  analyticsSheet.getRange("B3").setFormula("=MAX('Telemetry Log'!D2:D)").setNumberFormat("0.0 \"W\"");

  analyticsSheet.getRange("C3").setValue("Average Voltage:").setFontWeight("bold");
  analyticsSheet.getRange("D3").setFormula("=AVERAGE('Telemetry Log'!B2:B)").setNumberFormat("0.0 \"V\"");

  analyticsSheet.getRange("E3").setValue("Total Energy:").setFontWeight("bold");
  analyticsSheet.getRange("F3").setFormula("=MAX('Telemetry Log'!E2:E)").setNumberFormat("0.0000 \"kWh\"");

  analyticsSheet.getRange("G3").setValue("Avg Power Factor:").setFontWeight("bold");
  analyticsSheet.getRange("H3").setFormula("=AVERAGE('Telemetry Log'!G2:G)").setNumberFormat("0.00");

  var lastRow = logSheet.getLastRow();
  if (lastRow > 2) {
    var range = logSheet.getRange("A1:D" + lastRow);
    var chart = analyticsSheet.newChart()
      .asLineChart()
      .addRange(range)
      .setPosition(5, 1, 0, 0)
      .setTitle("Real-Time Telemetry Trends (Power, Voltage & Current)")
      .setXAxisTitle("Time")
      .setOption("curveType", "function")
      .setOption("legend", { position: "top" })
      .setOption("width", 900)
      .setOption("height", 450)
      .build();

    analyticsSheet.insertChart(chart);
  }

  SpreadsheetApp.getUi().alert("Data Analysis Dashboard created successfully!");
}

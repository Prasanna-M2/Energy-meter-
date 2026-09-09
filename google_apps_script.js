/**
 * Google Apps Script for ESP32 Real-Time Energy Monitor
 * 
 * Instructions:
 * 1. Open Google Sheets at https://sheets.new
 * 2. Add header row: Timestamp | Voltage (V) | Current (A) | Power (W) | Energy (kWh) | Frequency (Hz) | Power Factor
 * 3. Extensions > Apps Script -> Paste this code -> Click Save
 * 4. Deploy > New deployment > Select 'Web app' > Who has access: 'Anyone' > Deploy
 * 5. Copy the Web app URL and use it in your ESP32 code or Web App Webhook!
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);
    
    var timestamp = new Date();
    var voltage = data.voltage || 0;
    var current = data.current || 0;
    var power = data.power || 0;
    var energy = data.energy || 0;
    var frequency = data.frequency || 50;
    var pf = data.pf || 1.0;

    // Append new row to Google Sheet
    sheet.appendRow([timestamp, voltage, current, power, energy, frequency, pf]);

    return ContentService.createTextOutput(JSON.stringify({ "result": "success", "message": "Telemetry logged" }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": error.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput("PulseIoT ESP32 Energy Monitor Webhook is Active!");
}

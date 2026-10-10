/**
 * Google Apps Script для экспорта бронирований в Google Sheets
 * Deploy as Web App with "Execute as: Me" and "Who has access: Anyone"
 */

const SHEET_ID = 'YOUR_SHEET_ID_HERE' // Замени на свой ID таблицы
const SECRET_KEY = 'YOUR_SECRET_KEY_HERE' // Секретный ключ для авторизации запросов

function doPost(e) {
  try {
    // Parse request
    const data = JSON.parse(e.postData.contents)

    // Verify secret key
    if (data.secret !== SECRET_KEY) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'Invalid secret key'
      })).setMimeType(ContentService.MimeType.JSON)
    }

    // Get spreadsheet
    const spreadsheet = SpreadsheetApp.openById(SHEET_ID)

    // Get or create sheet
    let sheet = spreadsheet.getSheetByName(data.sheetName)
    if (!sheet) {
      sheet = spreadsheet.insertSheet(data.sheetName)
    }

    // Clear existing data
    sheet.clear()

    // Write data
    if (data.rows && data.rows.length > 0) {
      sheet.getRange(1, 1, data.rows.length, data.rows[0].length).setValues(data.rows)

      // Format header row
      sheet.getRange(1, 1, 1, data.rows[0].length)
        .setFontWeight('bold')
        .setBackground('#4285f4')
        .setFontColor('#ffffff')
    }

    // Auto-resize columns
    for (let i = 1; i <= data.rows[0].length; i++) {
      sheet.autoResizeColumn(i)
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      sheetUrl: spreadsheet.getUrl()
    })).setMimeType(ContentService.MimeType.JSON)

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON)
  }
}

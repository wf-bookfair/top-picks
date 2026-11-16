const GRADE_TABS = Object.freeze({
  K: "Kinder",
  1: "Grade 1",
  2: "Grade 2",
  3: "Grade 3",
  4: "Grade 4",
  5: "Grade 5",
  6: "Grade 6",
  7: "Grade 7",
  8: "Grade 8",
});

const HEADERS = [
  "First Name",
  "Last Name",
  "Grade",
  "Book 1",
  "Book 2",
  "Book 3",
  "Book 4",
  "Book 5",
  "Duplicate",
  "Timestamp",
];

const TIME_ZONE = "America/Los_Angeles";

// Sheet IDs are NOT stored in this repo. Set a Script Property named
// GRADE_SPREADSHEET_IDS (Apps Script editor > Project Settings > Script Properties)
// with JSON like {"K":"<id>","1":"<id>", ... ,"8":"<id>"}.
function getGradeSpreadsheetIds_() {
  const raw = PropertiesService.getScriptProperties().getProperty("GRADE_SPREADSHEET_IDS");
  if (!raw) throw new Error("Script Property GRADE_SPREADSHEET_IDS is not set.");
  return JSON.parse(raw);
}

const BLOCKED_ROOTS = ["fuck", "shit", "cunt", "bitch", "whore", "slut", "dildo", "porn"];
const BLOCKED_WORDS = [
  "ass", "asses", "asshole", "bastard", "cock", "piss", "nigger", "nigga", "faggot", "fag",
  "retard", "tits", "boobs", "sexy", "wtf", "stfu",
];
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i" };

function containsBlockedWord(value) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[013457@$!]/g, (c) => LEET[c]);
  const squashed = text.replace(/[^\p{L}]/gu, "");
  const deduped = squashed.replace(/(\p{L})\1{2,}/gu, "$1");
  if (BLOCKED_ROOTS.some((root) => squashed.includes(root) || deduped.includes(root))) return true;
  return text.split(/[^\p{L}]+/u).some((word) => BLOCKED_WORDS.includes(word));
}
const MAX_SENDS_PER_MINUTE = 24;

function doPost(event) {
  try {
    const payload = event?.parameter || {};
    if (String(payload.website || "").trim()) return jsonResponse_({ ok: true });
    const grade = String(payload.grade || "").trim();
    const values = {
      "first name": cleanCell_(payload.firstName),
      "last name": cleanCell_(payload.lastName),
      grade: grade,
      timestamp: new Date(),
    };
    [1, 2, 3, 4, 5].forEach((number) => {
      values[`book ${number}`] = cleanCell_(payload[`book${number}`]);
    });

    if (
      !/^\p{L}{2,15}$/u.test(values["first name"]) ||
      !/^\p{L}$/u.test(values["last name"]) ||
      !GRADE_TABS[grade]
    ) {
      return jsonResponse_({ ok: false, error: "Missing or invalid student information." });
    }
    if (![1, 2, 3, 4, 5].some((number) => values[`book ${number}`])) {
      return jsonResponse_({ ok: false, error: "At least one book is required." });
    }

    if (
      containsBlockedWord(values["first name"]) ||
      [1, 2, 3, 4, 5].some((number) => containsBlockedWord(values[`book ${number}`]))
    ) {
      return jsonResponse_({ ok: false, error: "blocked" });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const cache = CacheService.getScriptCache();
      const minuteKey = `sends-${Math.floor(Date.now() / 60000)}`;
      const sends = Number(cache.get(minuteKey) || 0);
      if (sends >= MAX_SENDS_PER_MINUTE) return jsonResponse_({ ok: false, error: "busy" });
      cache.put(minuteKey, String(sends + 1), 120);
      const spreadsheet = SpreadsheetApp.openById(getGradeSpreadsheetIds_()[grade]);
      insertSorted_(prepareSheet_(spreadsheet.getSheets()[0]), values);
    } finally {
      lock.releaseLock();
    }

    return jsonResponse_({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, error: "The submission could not be saved." });
  }
}

function resetAllGradeSheets() {
  Object.values(getGradeSpreadsheetIds_()).forEach((id) => {
    const spreadsheet = SpreadsheetApp.openById(id);
    spreadsheet.setSpreadsheetTimeZone(TIME_ZONE);
    const sheet = spreadsheet.getSheets()[0];
    sheet.clear();
    if (sheet.getMaxColumns() > HEADERS.length) {
      sheet.deleteColumns(HEADERS.length + 1, sheet.getMaxColumns() - HEADERS.length);
    }
    prepareSheet_(sheet);
    sheet.getRange(2, HEADERS.length, sheet.getMaxRows() - 1, 1).setNumberFormat("M/d/yyyy HH:mm:ss");
  });
}

function insertSorted_(sheet, values) {
  const lastRow = sheet.getLastRow();
  const width = Math.max(sheet.getLastColumn(), HEADERS.length);
  const table = sheet.getRange(1, 1, lastRow, width).getValues();
  const headers = table[0].map(headerKey_);
  const data = table.slice(1);
  const firstIndex = headers.indexOf("first name");
  const lastIndex = headers.indexOf("last name");
  const timestampCol = headers.indexOf("timestamp") + 1;

  values.duplicate = data.some(
    (row) =>
      String(row[firstIndex]).trim().toLowerCase() === values["first name"].toLowerCase() &&
      String(row[lastIndex]).trim().charAt(0).toLowerCase() === values["last name"].toLowerCase()
  )
    ? "Maybe Duplicate"
    : "";

  const newKey = sortKey_(values["first name"], values["last name"]);
  const index = data.findIndex((row) => sortKey_(row[firstIndex], row[lastIndex]).localeCompare(newKey) > 0);
  let targetRow = lastRow + 1;
  if (index >= 0) {
    targetRow = index + 2;
    sheet.insertRowBefore(targetRow);
  }
  sheet.getRange(targetRow, 1, 1, width).setValues([headers.map((header) => (header in values ? values[header] : ""))]);
  if (timestampCol > 0) sheet.getRange(targetRow, timestampCol).setNumberFormat("M/d/yyyy HH:mm:ss");
}

function headerKey_(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^student(?:'s)? /, "")
    .replace(/ initial$/, "");
}

function sortKey_(firstName, lastName) {
  return `${String(firstName || "").trim().toLowerCase()}\u0000${String(lastName || "").trim().toLowerCase()}`;
}

function prepareSheet_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#dce9df");
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, HEADERS.length);
  }
  return sheet;
}

function cleanCell_(value) {
  const cleaned = String(value || "").trim();
  return /^[=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

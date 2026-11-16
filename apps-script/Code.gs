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
const MAX_SENDS_PER_MINUTE = 40;
const SPIKE_ALERT_AT = 30; // email when this many sends land in one minute
const DIGEST_MINUTES = 10;

// Lightweight ping so the page can wake the script before a student sends.
function doGet() {
  return jsonResponse_({ ok: true });
}

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
      if (sends + 1 >= SPIKE_ALERT_AT) spikeAlert_(sends + 1, cache);
      if (sends >= MAX_SENDS_PER_MINUTE) return jsonResponse_({ ok: false, error: "busy" });
      cache.put(minuteKey, String(sends + 1), 120);
      const spreadsheet = SpreadsheetApp.openById(getGradeSpreadsheetIds_()[grade]);
      insertSorted_(spreadsheet.getSheets()[0], values);
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

// Column layout is fixed by HEADERS (First Name, Last Name, ... Timestamp). Do not reorder
// or insert columns in the grade sheets; this keeps each send to a minimum of Sheets calls.
function insertSorted_(sheet, values) {
  let lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    prepareSheet_(sheet);
    lastRow = 1;
  }
  const names = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];

  values.duplicate = names.some(
    (row) =>
      String(row[0]).trim().toLowerCase() === values["first name"].toLowerCase() &&
      String(row[1]).trim().charAt(0).toLowerCase() === values["last name"].toLowerCase()
  )
    ? "Maybe Duplicate"
    : "";

  const newKey = sortKey_(values["first name"], values["last name"]);
  const index = names.findIndex((row) => sortKey_(row[0], row[1]).localeCompare(newKey) > 0);
  let targetRow = lastRow + 1;
  if (index >= 0) {
    targetRow = index + 2;
    sheet.insertRowBefore(targetRow);
  }
  const keys = HEADERS.map(headerKey_);
  sheet.getRange(targetRow, 1, 1, HEADERS.length).setValues([keys.map((key) => (key in values ? values[key] : ""))]);
  // Rows past the end already carry the timestamp format; only inserted rows need it set.
  if (index >= 0) sheet.getRange(targetRow, HEADERS.length).setNumberFormat("M/d/yyyy HH:mm:ss");
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

// ---------- Email alerts (no student names are ever included) ----------

function ownerEmail_() {
  return Session.getEffectiveUser().getEmail();
}

// At most one spike email per hour. Never lets an email problem break a submission.
function spikeAlert_(count, cache) {
  try {
    if (cache.get("spike-alert-sent")) return;
    cache.put("spike-alert-sent", "1", 3600);
    MailApp.sendEmail(
      ownerEmail_(),
      "Top Picks: send spike",
      `${count} submissions arrived within one minute (the limit is ${MAX_SENDS_PER_MINUTE}/min).\n` +
        "This may just be a rush of families, or it could be someone flooding the form.\n" +
        "If it looks wrong, check the grade sheets for junk rows."
    );
  } catch (error) {
    console.error(error);
  }
}

// Runs every DIGEST_MINUTES minutes from a trigger. Emails only if there were new entries.
function sendDigest() {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  const since = Number(props.getProperty("DIGEST_LAST") || now - DIGEST_MINUTES * 60000);
  const ids = getGradeSpreadsheetIds_();
  const lines = [];
  let fresh = 0;
  ["K", "1", "2", "3", "4", "5", "6", "7", "8"].forEach((grade) => {
    const sheet = SpreadsheetApp.openById(ids[grade]).getSheets()[0];
    const lastRow = sheet.getLastRow();
    let count = 0;
    if (lastRow > 1) {
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(headerKey_);
      const col = headers.indexOf("timestamp") + 1;
      if (col > 0) {
        count = sheet
          .getRange(2, col, lastRow - 1, 1)
          .getValues()
          .filter((row) => row[0] instanceof Date && row[0].getTime() > since && row[0].getTime() <= now).length;
      }
    }
    fresh += count;
    lines.push(`${GRADE_TABS[grade]}: ${count} new (${Math.max(lastRow - 1, 0)} total)`);
  });
  props.setProperty("DIGEST_LAST", String(now));
  if (!fresh || MailApp.getRemainingDailyQuota() < 5) return;
  const fmt = (ms) => Utilities.formatDate(new Date(ms), TIME_ZONE, "h:mm a");
  MailApp.sendEmail(
    ownerEmail_(),
    `Top Picks: ${fresh} new since ${fmt(since)}`,
    `${fresh} new submissions between ${fmt(since)} and ${fmt(now)}.\n\n${lines.join("\n")}`
  );
}

// Run this once from the editor (and approve the permissions) to start the digest.
function installDigest() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "sendDigest")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger("sendDigest").timeBased().everyMinutes(DIGEST_MINUTES).create();
  PropertiesService.getScriptProperties().setProperty("DIGEST_LAST", String(Date.now()));
}

// Run this to stop the digest emails.
function removeDigest() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "sendDigest")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
}

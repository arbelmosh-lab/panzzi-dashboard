/**
 * PanzziFeeder: API לדשבורד
 * קובץ באותו פרויקט Apps Script של הגיליון (ליד PanzziFeeder_Sheets.gs).
 * מחזיר JSON עם הנתונים של הימים האחרונים. הדשבורד ב-GitHub Pages קורא אותו.
 * הגיליון עצמו נשאר פרטי: הקוד רץ בהרשאה של הבעלים, ושולח החוצה רק את העמודות שהדשבורד צריך.
 *
 * התקנה:
 * 1. Apps Script: ‎+‎ ליד Files ← Script ← שם "Api" ← להדביק את הקובץ הזה.
 * 2. ב-PanzziFeeder_Sheets.gs להחליף רק את הפונקציה doGet בשורה:
 *        function doGet(e) { return apiGet_(e); }
 * 3. להריץ פעם אחת testApi ולאשר הרשאות.
 * 4. Deploy ← New deployment ← Web app. Execute as: Me. Who has access: Anyone.
 *    להעתיק את הכתובת (נגמרת ב-/exec) לקובץ config.js בריפו.
 *    הפריסה הקיימת שה-ESP32 שולח אליה לא משתנה.
 * 5. כשמשנים את הקוד: Deploy ← Manage deployments ← עריכה ← Version: New version. הכתובת לא משתנה.
 *
 * ‎?ping=1 מחזיר "PanzziFeeder OK" כמו קודם.
 */

const API = {
  EVENTS: 'events',
  DAILY: 'daily',
  TZ: 'Asia/Jerusalem',
  DAYS: 3,                                  // כמה ימים אחורה לשלוח
  KIBBLE: 'מיקס לה קט',                     // סוג המזון שבמיכל
  INSIGHTS_FILE: 'panzzi-insights.json',    // לא חובה: תובנות של Claude מ-Drive
  CACHE_SEC: 60,                            // כמה זמן לשמור תשובה במטמון
};

function apiGet_(e) {
  if (e && e.parameter && e.parameter.ping) {
    return ContentService.createTextOutput('PanzziFeeder OK');
  }
  const cache = CacheService.getScriptCache();
  let body = cache.get('api');
  if (!body) {
    body = JSON.stringify(buildData_());
    if (body.length < 100000) cache.put('api', body, API.CACHE_SEC);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function buildData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = Date.now();
  const since = now - API.DAYS * 86400000;

  // events: קוראים מהסוף אחורה עד שמגיעים לשורות ישנות
  const ev = ss.getSheetByName(API.EVENTS);
  const last = ev.getLastRow();
  const cols = ev.getLastColumn();
  const head = ev.getRange(1, 1, 1, cols).getValues()[0].map(String);
  const c = (n) => head.indexOf(n);
  const rows = [];
  const CHUNK = 500;
  for (let end = last; end >= 2; end -= CHUNK) {
    const start = Math.max(2, end - CHUNK + 1);
    const vals = ev.getRange(start, 1, end - start + 1, cols).getValues();
    let older = false;
    for (let i = vals.length - 1; i >= 0; i--) {
      const r = vals[i];
      const ms = apiMs_(r[c('received')]);
      if (!ms) continue;
      if (ms < since) { older = true; break; }
      let what = '';
      if (String(r[c('event')]) === 'error') {
        try { what = JSON.parse(r[c('raw')]).what || ''; } catch (err) { what = ''; }
      }
      // [זמן, device_ms, event, snd, shake, cooldown, humidity, temp_c, distance_cm, what]
      rows.push([ms, apiNum_(r[c('device_ms')]), String(r[c('event')] || ''), apiNum_(r[c('snd')]),
        apiNum_(r[c('shake')]), apiNum_(r[c('cooldown')]), apiNum_(r[c('humidity')]),
        apiNum_(r[c('temp_c')]), apiNum_(r[c('distance_cm')]), what]);
    }
    if (older) break;
  }
  rows.reverse();

  // daily: סיכום של ימים שהסתיימו (נכתב ע"י panzzi-archive.gs)
  let daily = [];
  const dsh = ss.getSheetByName(API.DAILY);
  if (dsh && dsh.getLastRow() > 1) {
    const dh = dsh.getRange(1, 1, 1, dsh.getLastColumn()).getValues()[0].map(String);
    const dv = dsh.getRange(2, 1, dsh.getLastRow() - 1, dsh.getLastColumn()).getValues();
    daily = dv.slice(-14).map((r) => ({
      date: r[0] instanceof Date ? Utilities.formatDate(r[0], API.TZ, 'yyyy-MM-dd') : String(r[0]),
      dispenses: apiNum_(r[dh.indexOf('dispenses')]),
      successful: apiNum_(r[dh.indexOf('successful')]),
      pellets: apiNum_(r[dh.indexOf('pellets')]),
      max_pellets: apiNum_(r[dh.indexOf('max_pellets')]),
    }));
  }

  return { now: now, rows: rows, daily: daily, kibble: API.KIBBLE, insights: readInsights_() };
}

function readInsights_() {
  try {
    const it = DriveApp.getFilesByName(API.INSIGHTS_FILE);
    if (!it.hasNext()) return null;
    return JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
  } catch (err) {
    return null;
  }
}

function apiNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// `received` חוזר כתאריך, או כטקסט "dd/mm/yyyy HH:MM:SS"
function apiMs_(v) {
  if (v instanceof Date) return v.getTime();
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Utilities.parseDate(`${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}`,
    API.TZ, 'yyyy-MM-dd HH:mm:ss').getTime();
}

/** בדיקה ידנית מתוך העורך. */
function testApi() {
  const d = buildData_();
  Logger.log(`נקראו ${d.rows.length} שורות מ-${API.DAYS} ימים, ${d.daily.length} ימים מ-daily, ` +
    `תובנות של Claude: ${d.insights ? 'יש' : 'אין'}. גודל: ${JSON.stringify(d).length} תווים.`);
}

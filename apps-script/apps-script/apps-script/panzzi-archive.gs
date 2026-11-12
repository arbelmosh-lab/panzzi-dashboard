/**
 * PanzziFeeder: ארכיון אוטומטי + סיכום יומי
 * רץ בתוך הגיליון PanzziFeeder (Extensions → Apps Script), פעם בלילה ב־03:00.
 *
 * מה הוא עושה:
 * 1. לשונית `daily`: שורה אחת לכל יום שהסתיים (לחיצות, הנפקות, מוצלחות, גרגרים, אתחולים, לחות, מפלס, משקל).
 *    הנפקה מוצלחת = חיישן הקול שמע לפחות גרגר אחד (snd ≥ 1). המשקל נרשם בנוסף.
 * 2. לשונית `archive`: שורות ב־events שישנות מ־KEEP_DAYS ימים עוברות לשם (לא נמחק כלום).
 *    כך events נשארת קטנה, והדשבורד והתראות הטלגרם ממשיכים לעבוד מהר.
 * 3. events נשארת תמיד הלשונית הראשונה (הדשבורד קורא רק אותה).
 *
 * עודכן 12/11/2026: הצלחה לפי גרמים + 3 עמודות חדשות בסוף daily:
 *    dispensed_g (כמה גרם הונפקו), eaten_g (כמה נאכל, מסכום שורות השעה), bowl_g_last (משקל הקערה בסוף היום).
 *    הכותרות של daily ו-archive מתעדכנות לבד. ימים שכבר סוכמו לא מחושבים מחדש.
 *
 * התקנה חד־פעמית:
 * 1. להדביק את הקובץ הזה כקובץ חדש באותו פרויקט Apps Script (סימן + ליד Files → Script).
 * 2. להריץ `archivePreview` ולבדוק ב־Execution log מה היה זז (לא משנה כלום).
 * 3. להריץ `archiveNow` פעם אחת (לאשר הרשאות).
 * 4. להריץ `installArchiveTrigger` פעם אחת. מעכשיו זה רץ לבד כל לילה.
 */

const ARCHIVE_CONFIG = {
  EVENTS: 'events',
  ARCHIVE: 'archive',
  DAILY: 'daily',
  KEEP_DAYS: 7,           // כמה ימים מלאים להשאיר ב־events (חוץ מהיום)
  MIN_GRAMS: 2,           // כמו MIN_GRAMS בקושחה
  TZ: 'Asia/Jerusalem',
};

const DAILY_HEADERS = ['date', 'presses', 'dispenses', 'successful', 'success_pct', 'pellets',
  'max_pellets', 'boots', 'errors', 'level_errors', 'humidity_avg', 'humidity_max', 'temp_avg',
  'distance_cm_last', 'rows', 'dispensed_g', 'eaten_g', 'bowl_g_last'];

function archiveNow() { runArchive_(false); }
function archivePreview() { runArchive_(true); }

function installArchiveTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'archiveNow')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('archiveNow').timeBased().atHour(3).nearMinute(10)
    .inTimezone(ARCHIVE_CONFIG.TZ).everyDays(1).create();
  Logger.log('הוגדר: archiveNow כל לילה בסביבות 03:10');
}

function runArchive_(dryRun) {
  const C = ARCHIVE_CONFIG;
  const lock = LockService.getScriptLock();   // אותו מנעול כמו doPost, כדי לא להתנגש בשורה חדשה
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ev = ss.getSheetByName(C.EVENTS);
    const last = ev.getLastRow();
    if (last < 2) { Logger.log('אין נתונים'); return; }
    const cols = ev.getLastColumn();
    const head = ev.getRange(1, 1, 1, cols).getValues()[0];
    const rows = ev.getRange(2, 1, last - 1, cols).getValues();
    const iTs = head.indexOf('received');

    const dayOf = (v) => {
      const ms = toMs_(v);
      return ms ? Utilities.formatDate(new Date(ms), C.TZ, 'yyyy-MM-dd') : null;
    };
    const today = Utilities.formatDate(new Date(), C.TZ, 'yyyy-MM-dd');
    const cutoffDay = Utilities.formatDate(new Date(Date.now() - C.KEEP_DAYS * 86400000), C.TZ, 'yyyy-MM-dd');

    // --- 1. סיכום יומי לימים שהסתיימו ושעוד לא סוכמו ---
    const daily = dryRun ? ss.getSheetByName(C.DAILY) : getOrCreate_(ss, C.DAILY, DAILY_HEADERS);
    const done = new Set();
    if (daily && daily.getLastRow() > 1) {
      // גיליון עשוי להפוך את הטקסט לתאריך, לכן מנרמלים חזרה ל־yyyy-MM-dd
      daily.getRange(2, 1, daily.getLastRow() - 1, 1).getValues().forEach((r) => {
        const v = r[0];
        done.add(v instanceof Date ? Utilities.formatDate(v, C.TZ, 'yyyy-MM-dd') : String(v));
      });
    }
    const byDay = {};
    rows.forEach((r) => {
      const d = dayOf(r[iTs]);
      if (d && d < today && !done.has(d)) (byDay[d] = byDay[d] || []).push(r);
    });
    const summaries = Object.keys(byDay).sort().map((d) => summarize_(d, byDay[d], head));

    // --- 2. העברת שורות ישנות לארכיון ---
    // השורות נכתבות לפי סדר הזמן, לכן הישנות הן בלוק רציף בהתחלה
    let nOld = 0;
    while (nOld < rows.length) {
      const d = dayOf(rows[nOld][iTs]);
      if (d && d >= cutoffDay) break;
      nOld++;
    }

    Logger.log(`events: ${rows.length} שורות. יעברו לארכיון: ${nOld}. יישארו: ${rows.length - nOld}. ` +
      `ימים חדשים לסיכום: ${summaries.map((s) => s[0]).join(', ') || 'אין'}.`);
    summaries.forEach((s) => Logger.log(`${s[0]}: ${s[3]}/${s[2]} מוצלחות, הונפקו ${s[15]} גרם, נאכלו ${s[16]} גרם`));
    if (dryRun) return;

    if (summaries.length) {
      daily.getRange(daily.getLastRow() + 1, 1, summaries.length, DAILY_HEADERS.length).setValues(summaries);
    }
    if (nOld > 0) {
      const ar = getOrCreate_(ss, C.ARCHIVE, head);
      ar.getRange(ar.getLastRow() + 1, 1, nOld, cols).setValues(rows.slice(0, nOld));
      SpreadsheetApp.flush();                 // לוודא שהארכיון נכתב לפני המחיקה
      ev.deleteRows(2, nOld);
    }

    // events חייבת להישאר ראשונה
    if (ev.getIndex() !== 1) { ss.setActiveSheet(ev); ss.moveActiveSheet(1); }
    Logger.log('הסתיים.');
  } finally {
    lock.releaseLock();
  }
}

function summarize_(day, rows, head) {
  const col = (n) => head.indexOf(n);
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const get = (r, n) => (col(n) >= 0 ? num(r[col(n)]) : null);   // עמודה שלא קיימת = null
  const ev = (r) => String(r[col('event')] || '');
  const disp = rows.filter((r) => ev(r) === 'dispense');
  const snd = disp.map((r) => num(r[col('snd')]) || 0);
  // שורה עם משקל: הצלחה לפי גרמים. שורה ישנה: לפי הקול
  const isOk = (r) => (num(r[col('snd')]) || 0) >= 1;   // הקול מחליט (קושחה 5.3)
  const ok = disp.filter(isOk).length;
  const weighed = disp.filter((r) => get(r, 'bowl_g') !== null);
  const dispensedG = weighed.reduce((s, r) => s + Math.max(0, get(r, 'grams') || 0), 0);
  const bowlRows = rows.filter((r) => ev(r) === 'bowl');
  const eaten = bowlRows.map((r) => get(r, 'eaten_g')).filter((v) => v !== null);
  const bowlAll = rows.map((r) => get(r, 'bowl_g')).filter((v) => v !== null);
  const errs = rows.filter((r) => ev(r) === 'error');
  const lvlErr = errs.filter((r) => String(r[col('raw')] || '').indexOf('level_read') >= 0).length;
  const hum = rows.map((r) => num(r[col('humidity')])).filter((v) => v !== null);
  const tmp = rows.map((r) => num(r[col('temp_c')])).filter((v) => v !== null);
  const dist = rows.map((r) => num(r[col('distance_cm')])).filter((v) => v !== null && v >= 1 && v <= 35);
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : '');
  const r1 = (v) => Math.round(v * 10) / 10;
  return [
    day,
    rows.filter((r) => ev(r) === 'press').length,
    disp.length,
    ok,
    disp.length ? Math.round((ok / disp.length) * 100) : '',
    snd.reduce((x, y) => x + y, 0),
    snd.length ? Math.max.apply(null, snd) : '',
    rows.filter((r) => ev(r) === 'boot').length,
    errs.length,
    lvlErr,
    avg(hum),
    hum.length ? Math.max.apply(null, hum) : '',
    avg(tmp),
    dist.length ? dist[dist.length - 1] : '',
    rows.length,
    weighed.length ? r1(dispensedG) : '',
    eaten.length ? r1(eaten.reduce((x, y) => x + y, 0)) : '',
    bowlAll.length ? bowlAll[bowlAll.length - 1] : '',
  ];
}

// יוצר לשונית אם חסרה. אם קיימת עם פחות כותרות (עמודות חדשות נוספו בסוף), מעדכן את שורת הכותרות.
function getOrCreate_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, ss.getNumSheets());   // תמיד בסוף, לא לפני events
    sh.setFrozenRows(1);
  }
  if (sh.getLastColumn() < headers.length || sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

// `received` יכול לחזור כתאריך או כטקסט "dd/mm/yyyy HH:MM:SS"
function toMs_(v) {
  if (v instanceof Date) return v.getTime();
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Utilities.parseDate(`${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}`,
    ARCHIVE_CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss').getTime();
}

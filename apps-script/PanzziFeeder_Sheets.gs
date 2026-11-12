// PanzziFeeder - מקבל אירועים מה-ESP32 וכותב אותם לגיליון
// להדביק ב: Google Sheets ← תוספים (Extensions) ← Apps Script
// עודכן 11/11/2026: עמודות משקל (bowl_g, eaten_g, dispensed_g) + התראת טלגרם מיידית על אירוע alert

const SECRET_KEY = '<SECRET_KEY>';   // להשאיר את המילה שכבר כתובה אצלך ב-Apps Script!
const SHEET_NAME = 'events';

const HEADERS = ['received', 'device_ms', 'event', 'ok', 'grams', 'snd', 'peak',
                 'tries', 'shake', 'cooldown', 'humidity', 'temp_c', 'raw',
                 'distance_cm', 'level_pct', 'bowl_g', 'eaten_g', 'dispensed_g'];

// הודעות לאירועי alert שמגיעים מהבקר (שליחה מיידית, בלי לחכות לבדיקה של כל 5 דקות)
const ALERT_TEXT = {
  // הקול מחליט שההנפקה נכשלה. המשקל (אם תקין) קובע אם לכתוב "קערה ריקה"
  empty_fail: (d) => {
    const hasBowl = typeof d.bowl === 'number';
    const head = !hasBowl || d.bowl < 2 ? '🔴 קערה ריקה והנפקה נכשלה' : '🟠 הנפקה נכשלה';
    const bowl = hasBowl ? `בקערה: ${d.bowl} גרם.` : 'המשקל לא זמין.';
    return `${head}\nגם אחרי ניעור (${d.tries} ניסיונות) לא נשמעו גרגרים. ${bowl}\nכדאי לבדוק תקיעה בתא ההנפקה או סילו ריק.`;
  },
};

function val(x) {
  return (x === undefined || x === null) ? '' : x;
}

function doPost(e) {
  if (!e || !e.parameter || e.parameter.key !== SECRET_KEY) {
    return ContentService.createTextOutput('forbidden');
  }
  let d = null;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) sh = ss.insertSheet(SHEET_NAME);
    // כותרות: נוצרות בפעם הראשונה ומתעדכנות אוטומטית כשמוסיפים עמודות
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
    const raw = e.postData ? e.postData.contents : '';
    d = JSON.parse(raw);
    sh.appendRow([
      new Date(), val(d.t), val(d.ev), val(d.ok), val(d.g), val(d.snd), val(d.peak),
      val(d.tries), val(d.shake), val(d.cd), val(d.rh), val(d.c), raw,
      val(d.cm), val(d.lvl), val(d.bowl), val(d.ate), val(d.disp)
    ]);
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  } finally {
    lock.releaseLock();
  }

  // טלגרם אחרי שחרור המנעול, כדי לא לעכב שורות אחרות. sendTelegram_ נמצאת ב-panzzi-telegram-alerts.gs
  if (d && d.ev === 'alert' && ALERT_TEXT[d.what]) {
    try { sendTelegram_(`PanzziFeeder\n${ALERT_TEXT[d.what](d)}`); } catch (err) { console.error(err); }
  }
  return ContentService.createTextOutput('ok');
}

// הדשבורד ב-GitHub Pages (Api.gs). ?ping=1 מחזיר "PanzziFeeder OK"
function doGet(e) { return apiGet_(e); }

// להרצה ידנית פעם אחת: בודק שהודעת הקערה הריקה מגיעה לטלגרם
function testEmptyBowlAlert() {
  sendTelegram_(`PanzziFeeder\n${ALERT_TEXT.empty_fail({ tries: 3, bowl: 0.0 })}`);
}

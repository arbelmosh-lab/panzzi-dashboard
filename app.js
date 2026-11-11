// ---------- הגדרות (זהות לדשבורד הקודם ולסוכן היומי) ----------
const TZ = 'Asia/Jerusalem';
const MIN_GRAMS = 2;              // כמו בקושחה: הנפקה מוצלחת = נוספו לפחות 2 גרם
const HUM_LIMIT = 65, HUM_HOURS = 6, NO_FOOD_HOURS = 12, OFFLINE_MIN = 60, BOOTS_MAX = 3, SILO_LOW = 20;
// מודל המיכל: [עומק מתחת לשפה בס"מ, קוטר בס"מ]. החיישן 2.6 ס"מ מתחת לשפה.
const PROFILE = [[0,16],[5.7,15.5],[11.2,14.6],[14.9,13.6],[17.5,12.6],[20.1,11.6],[23,10],[25.9,8.2],[30,7.4]];
const SENSOR_OFFSET = 2.6, SILO_H = 30;

const H = 3600000;
const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = (ms, o) => new Intl.DateTimeFormat('he-IL', Object.assign({ timeZone: TZ }, o)).format(new Date(ms));
const hm = (ms) => fmt(ms, { hour: '2-digit', minute: '2-digit', hour12: false });
const dhm = (ms) => fmt(ms, { day: '2-digit', month: '2-digit' }) + ' ' + hm(ms);
const hourOf = (ms) => Number(fmt(ms, { hour: '2-digit', hour12: false })) % 24;
const dayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
// שורה עם משקל (קושחה 5.2): הצלחה לפי גרמים. שורה ישנה: לפי חיישן הקול
const isOk = (r) => (r.bowl != null ? r.g != null && r.g >= MIN_GRAMS : r.snd != null && r.snd >= 1);
const g1 = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1));
const dur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? m + ' דק׳' : Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ' שע׳'; };

function diamAt(z) {
  for (let i = 1; i < PROFILE.length; i++) {
    const [z0, d0] = PROFILE[i - 1], [z1, d1] = PROFILE[i];
    if (z <= z1) return d0 + (d1 - d0) * (z - z0) / (z1 - z0);
  }
  return PROFILE[PROFILE.length - 1][1];
}
function litresBelow(depth) {          // נפח מהעומק הזה ועד התחתית
  const z0 = Math.min(Math.max(depth, 0), SILO_H), N = 300, dz = (SILO_H - z0) / N;
  let v = 0;
  for (let i = 0; i < N; i++) { const d = diamAt(z0 + (i + 0.5) * dz); v += Math.PI * d * d / 4 * dz; }
  return v / 1000;
}
const FULL_L = litresBelow(0);
const siloFrom = (cm) => { const L = litresBelow(cm + SENSOR_OFFSET); return { L, pct: L / FULL_L * 100 }; };

// ---------- גרפים ב-SVG (בלי ספריות חיצוניות) ----------
function axisMax(v) { if (v <= 5) return 5; const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p) * p; }

function barChart(el, labels, series, opt) {
  // series: [{values, color}] מצוירים זה על זה (הגדול מאחור)
  const W = 640, Hh = opt && opt.h || 200, L = 30, B = 22, T = 8, R = 6;
  const max = axisMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = labels.length, bw = (W - L - R) / n;
  let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img">`;
  for (let k = 0; k <= 4; k++) {
    const y = T + (Hh - T - B) * (1 - k / 4);
    s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${css('--line')}"/>`;
    s += `<text x="${L - 4}" y="${y + 4}" text-anchor="end">${Math.round(max * k / 4)}</text>`;
  }
  series.forEach((ser, si) => {
    const pad = bw * (0.12 + si * 0.12);
    ser.values.forEach((v, i) => {
      if (!v) return;
      const h = (Hh - T - B) * v / max;
      s += `<rect x="${L + i * bw + pad}" y="${Hh - B - h}" width="${Math.max(1, bw - 2 * pad)}" height="${h}" rx="2" fill="${ser.color}"><title>${esc(labels[i])}: ${v}</title></rect>`;
    });
  });
  const every = Math.ceil(n / 12);
  labels.forEach((lab, i) => { if (i % every === 0) s += `<text x="${L + i * bw + bw / 2}" y="${Hh - 6}" text-anchor="middle">${esc(lab)}</text>`; });
  el.innerHTML = s + '</svg>';
}

function lineChart(el, pts, t0, t1, opt) {
  const W = 640, Hh = 180, L = 34, B = 22, T = 8, R = 6;
  if (!pts.length) { el.innerHTML = '<p class="muted">אין קריאות</p>'; return; }
  const lo = opt.min, hi = opt.max;
  const x = (t) => L + (W - L - R) * (t - t0) / (t1 - t0);
  const y = (v) => T + (Hh - T - B) * (1 - (v - lo) / (hi - lo));
  let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img">`;
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * k / 4;
    s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${css('--line')}"/>`;
    s += `<text x="${L - 4}" y="${y(v) + 4}" text-anchor="end">${opt.dec ? v.toFixed(1) : Math.round(v)}</text>`;
  }
  if (opt.limit != null) s += `<line x1="${L}" x2="${W - R}" y1="${y(opt.limit)}" y2="${y(opt.limit)}" stroke="${css('--bad')}" stroke-dasharray="4 4"/>`;
  // שובר את הקו בפערים (ברירת מחדל 30 דקות: המאכיל לא שידר)
  const gap = opt.gap || 0.5 * H;
  let d = '', prev = null;
  pts.forEach((p) => { d += (prev && p[0] - prev[0] < gap ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); prev = p; });
  s += `<path d="${d}" fill="none" stroke="${opt.color}" stroke-width="2"/>`;
  if (opt.dots) pts.forEach((p) => { s += `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="2.5" fill="${opt.color}"><title>${dhm(p[0])}: ${g1(p[1])}</title></circle>`; });
  for (let t = Math.ceil(t0 / (6 * H)) * 6 * H; t <= t1; t += 6 * H) {
    s += `<text x="${x(t)}" y="${Hh - 6}" text-anchor="middle">${hourOf(t) === 0 ? fmt(t, { day: '2-digit', month: '2-digit' }) : hm(t)}</text>`;
  }
  el.innerHTML = s + '</svg>';
}

// ---------- חישובים ----------
function analyse(d) {
  const now = d.now;
  // שורת API: [זמן, device_ms, event, snd, shake, cooldown, humidity, temp_c, distance_cm, what, grams, bowl_g, eaten_g, dispensed_g]
  const rows = d.rows.map((r) => ({ t: r[0], ms: r[1], ev: r[2], snd: r[3], shake: r[4], cd: r[5], rh: r[6], c: r[7], cm: r[8], what: r[9],
    g: r[10] ?? null, bowl: r[11] ?? null, ate: r[12] ?? null, dg: r[13] ?? null }));
  const in24 = rows.filter((r) => r.t >= now - 24 * H);
  const disp = rows.filter((r) => r.ev === 'dispense');
  const disp24 = in24.filter((r) => r.ev === 'dispense');
  const ok24 = disp24.filter(isOk);
  const press24 = in24.filter((r) => r.ev === 'press');
  const okAll = disp.filter(isOk);
  const lastOk = okAll.length ? okAll[okAll.length - 1] : null;

  // אתחולים: שורת boot, או שעון הבקר שהתאפס (שורת boot לפעמים הולכת לאיבוד לפני שה-Wi-Fi עולה)
  const boots = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (r.ev === 'boot' || (prev && r.ms != null && prev.ms != null && r.ms < prev.ms)) {
      const at = r.ms != null ? r.t - r.ms : r.t;
      if (!boots.length || Math.abs(boots[boots.length - 1] - at) > 60000) boots.push(at);
    }
  });
  const boots24 = boots.filter((t) => t >= now - 24 * H);

  // פערים בשידור
  const gaps = [];
  for (let i = 1; i < rows.length; i++) if (rows[i].t - rows[i - 1].t > 0.5 * H) gaps.push([rows[i - 1].t, rows[i].t]);
  const lastSeen = rows.length ? rows[rows.length - 1].t : null;

  // מיכל: קריאות בין 1 ל-35 ס"מ בלבד, חציון של 3 האחרונות נגד רעש
  const silo = rows.filter((r) => r.ev === 'silo');
  const valid = silo.filter((r) => r.cm != null && r.cm >= 1 && r.cm <= 35);
  const lastCm = valid.slice(-3).map((r) => r.cm).sort((a, b) => a - b);
  const cmNow = lastCm.length ? lastCm[Math.floor(lastCm.length / 2)] : null;
  const siloNow = cmNow != null ? siloFrom(cmNow) : null;

  // לחות: הרצף הארוך ביותר מעל 65% ב-24 שעות
  const hum = silo.filter((r) => r.rh != null);
  let run = 0, runStart = null;
  hum.filter((r) => r.t >= now - 24 * H).forEach((r) => {
    if (r.rh > HUM_LIMIT) { if (runStart == null) runStart = r.t; run = Math.max(run, r.t - runStart); } else runStart = null;
  });
  const humNow = hum.length ? hum[hum.length - 1] : null;

  const grains24 = ok24.reduce((a, r) => a + r.snd, 0);
  const shakes24 = disp24.filter((r) => r.shake === 1);
  const recordRow = disp.reduce((best, r) => (r.snd != null && (!best || r.snd > best.snd) ? r : best), null);
  const dailyMax = Math.max(0, ...d.daily.map((x) => x.max_pellets || 0));

  // משקל: נקודות מהשורות השעתיות ומשורות ההנפקה, וכמה נאכל
  const bowlPts = rows.filter((r) => r.bowl != null && (r.ev === 'bowl' || r.ev === 'dispense'));
  const bowlNow = bowlPts.length ? bowlPts[bowlPts.length - 1] : null;
  const weighed24 = disp24.filter((r) => r.bowl != null);
  const grams24 = weighed24.reduce((s, r) => s + Math.max(0, r.g || 0), 0);
  const eatenRows = rows.filter((r) => r.ev === 'bowl' && r.ate != null);
  const eaten24 = eatenRows.filter((r) => r.t >= now - 24 * H).reduce((s, r) => s + r.ate, 0);
  const emptyFails = rows.filter((r) => r.ev === 'alert' && r.what === 'empty_fail');

  return { now, rows, disp, bowlPts, bowlNow, weighed24, grams24, eatenRows, eaten24, emptyFails, disp24, ok24, press24, lastOk, boots, boots24, gaps, lastSeen, valid, siloNow, cmNow,
    hum, humNow, humRun: run, grains24, shakes24, recordRow, dailyMax,
    errors24: in24.filter((r) => r.ev === 'error'), blocked24: press24.filter((r) => r.cd === 1) };
}

function alertsOf(a) {
  const out = [];
  const offline = a.lastSeen ? a.now - a.lastSeen : Infinity;
  if (offline > OFFLINE_MIN * 60000) out.push(['bad', `המאכיל לא שולח נתונים כבר ${dur(offline)} (אחרון: ${a.lastSeen ? dhm(a.lastSeen) : 'אין'})`]);
  const noFood = a.lastOk ? a.now - a.lastOk.t : Infinity;
  if (noFood > NO_FOOD_HOURS * H) out.push(['bad', `אין הנפקה מוצלחת כבר ${dur(noFood)}`]);
  if (a.siloNow && a.siloNow.pct < SILO_LOW) out.push(['warn', `נשאר מעט אוכל במיכל: ${Math.round(a.siloNow.pct)}% (${a.siloNow.L.toFixed(2)} ליטר)`]);
  if (a.humRun > HUM_HOURS * H) out.push(['warn', `הלחות מעל ${HUM_LIMIT}% במשך ${dur(a.humRun)} ברצף`]);
  if (a.boots24.length >= BOOTS_MAX) out.push(['warn', `${a.boots24.length} אתחולים ב-24 שעות: ${a.boots24.map(hm).join(', ')}`]);
  const rate = a.disp24.length ? a.ok24.length / a.disp24.length : null;
  if (rate != null && a.disp24.length >= 5 && rate < 0.5) out.push(['notice', `רק ${Math.round(rate * 100)}% מההנפקות הצליחו ב-24 שעות (${a.ok24.length} מתוך ${a.disp24.length})`]);
  a.gaps.filter((g) => g[1] >= a.now - 24 * H).forEach((g) => out.push(['notice', `פער בשידור: ${dhm(g[0])} עד ${hm(g[1])} (${dur(g[1] - g[0])})`]));
  a.emptyFails.filter((r) => r.t >= a.now - 24 * H).forEach((r) => {
    const fixed = a.lastOk && a.lastOk.t > r.t;
    out.push([fixed ? 'notice' : 'warn', `קערה ריקה והנפקה נכשלה ב-${dhm(r.t)}` + (fixed ? ' (אחר כך הייתה הנפקה מוצלחת)' : '')]);
  });
  if (!out.some((x) => x[0] === 'bad' || x[0] === 'warn')) out.unshift(['ok', 'המאכיל מחובר, החתול אוכל, והמיכל והלחות בטווח']);
  return out;
}

const SEV = { bad: ['--bad', 'תקלה'], warn: ['--warn', 'לשים לב'], notice: ['--notice', 'לידיעה'], ok: ['--ok', 'תקין'] };

// ---------- ציור ----------
function render(d) {
  $('err').style.display = 'none';
  const a = analyse(d), al = alertsOf(a);
  const top = al.some((x) => x[0] === 'bad') ? 'bad' : al.some((x) => x[0] === 'warn') ? 'warn' : 'ok';
  $('status').textContent = { bad: '🔴 יש תקלה', warn: '🟠 לשים לב', ok: '🟢 תקין' }[top];
  $('status').style.background = css(SEV[top][0]);
  $('seen').textContent = a.lastSeen ? `נתון אחרון מהמאכיל: ${dhm(a.lastSeen)} · הדף נטען ${hm(d.now)}` : 'אין נתונים מהמאכיל';

  const rate = a.disp24.length ? Math.round(a.ok24.length / a.disp24.length * 100) : null;
  const rec = Math.max(a.recordRow ? a.recordRow.snd : 0, a.dailyMax);
  const kpis = [
    ['הנפקות ב-24 שעות', a.disp24.length, `${a.press24.length} לחיצות, ${a.blocked24.length} נחסמו בצינון`],
    ['הנפקות מוצלחות', rate == null ? '–' : rate + '%', `${a.ok24.length} מתוך ${a.disp24.length}`],
    a.weighed24.length
      ? ['הונפק ב-24 שעות', g1(a.grams24) + ' ג׳', `ממוצע ${g1(a.grams24 / Math.max(1, a.ok24.length))} ג׳ בהנפקה מוצלחת`]
      : ['גרגרים ב-24 שעות', a.grains24, a.ok24.length ? `חציון ${median(a.ok24.map((r) => r.snd))} בהנפקה` : ''],
    ['בקערה עכשיו', a.bowlNow ? g1(Math.max(0, a.bowlNow.bowl)) + ' ג׳' : '–', a.bowlNow ? `נשקל ב-${dhm(a.bowlNow.t)}` : 'אין עדיין משקל'],
    ['נאכל ב-24 שעות', a.eatenRows.length ? g1(a.eaten24) + ' ג׳' : '–', a.eatenRows.length ? 'לפי שקילה כל שעה' : 'מתחיל אחרי שתי שקילות'],
    ['הנפקה מוצלחת אחרונה', a.lastOk ? hm(a.lastOk.t) : '–', a.lastOk ? `${a.lastOk.bowl != null ? g1(a.lastOk.g) + ' ג׳' : a.lastOk.snd + ' גרגרים'} · לפני ${dur(a.now - a.lastOk.t)}` : ''],
    ['אוכל במיכל', a.siloNow ? Math.round(a.siloNow.pct) + '%' : '–', a.siloNow ? `${a.siloNow.L.toFixed(2)} ליטר · ${esc(d.kibble)}` : ''],
    ['לחות במיכל', a.humNow ? a.humNow.rh + '%' : '–', a.humNow && a.humNow.c != null ? `${a.humNow.c}°C` : ''],
    ['אתחולים ב-24 שעות', a.boots24.length, a.boots24.length ? a.boots24.map(hm).join(', ') : 'אין'],
    ['שיא גרגרים בהנפקה', rec || '–', a.recordRow && a.recordRow.snd >= a.dailyMax ? dhm(a.recordRow.t) : 'מתוך הסיכום היומי'],
  ];
  $('kpis').innerHTML = kpis.map((k) => `<div class="card kpi"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="s">${k[2]}</div></div>`).join('');

  $('alerts').innerHTML = al.map((x) => `<li><span class="sev" style="color:${css(SEV[x[0]][0])}">${SEV[x[0]][1]}:</span> ${esc(x[1])}</li>`).join('');

  // לפי שעה, 24 שעות אחרונות
  const startH = Math.floor((a.now - 23 * H) / H) * H;
  const labels = [], P = [], D = [], S = [];
  for (let i = 0; i < 24; i++) { labels.push(String(hourOf(startH + i * H)).padStart(2, '0')); P.push(0); D.push(0); S.push(0); }
  a.rows.forEach((r) => {
    const i = Math.floor((r.t - startH) / H);
    if (i < 0 || i > 23) return;
    if (r.ev === 'press') P[i]++;
    if (r.ev === 'dispense') { D[i]++; if (isOk(r)) S[i]++; }
  });
  barChart($('hourly'), labels, [{ values: P, color: css('--c1') }, { values: D, color: css('--c2') }, { values: S, color: css('--c3') }]);

  // משקל הקערה (3 ימים) ונאכל לפי שעה (24 שעות)
  const tb = a.now - 72 * H;
  const bp = a.bowlPts.filter((r) => r.t >= tb).map((r) => [r.t, Math.max(0, r.bowl)]);
  lineChart($('bowl'), bp, tb, a.now,
    { min: 0, max: axisMax(Math.max(10, ...bp.map((p) => p[1]))), color: css('--c3'), dec: false, gap: 2 * H, dots: true });
  const E = labels.map(() => 0);
  a.eatenRows.forEach((r) => { const i = Math.floor((r.t - startH) / H); if (i >= 0 && i <= 23) E[i] += Math.round(r.ate * 10) / 10; });
  barChart($('eaten'), labels, [{ values: E, color: css('--hum') }], { h: 180 });

  const t0 = a.now - 72 * H;
  lineChart($('silo'), a.valid.filter((r) => r.t >= t0).map((r) => [r.t, siloFrom(r.cm).L]), t0, a.now,
    { min: 0, max: Math.ceil(FULL_L), color: css('--c3'), dec: true });
  lineChart($('hum'), a.hum.filter((r) => r.t >= t0).map((r) => [r.t, r.rh]), t0, a.now,
    { min: 30, max: 90, limit: HUM_LIMIT, color: css('--hum') });

  // לפי יום: daily (ימים שהסתיימו) + הימים שבנתונים החיים
  const byDay = {};
  d.daily.forEach((x) => { byDay[x.date] = { n: x.dispenses || 0, s: x.successful || 0 }; });
  const live = {};
  a.disp.forEach((r) => { const k = dayKey(r.t); live[k] = live[k] || { n: 0, s: 0 }; live[k].n++; if (isOk(r)) live[k].s++; });
  Object.keys(live).forEach((k) => { if (!byDay[k] || k === dayKey(a.now)) byDay[k] = live[k]; });
  const keys = Object.keys(byDay).sort().slice(-10);
  barChart($('days'), keys.map((k) => k.slice(8, 10) + '/' + k.slice(5, 7)),
    [{ values: keys.map((k) => byDay[k].n), color: css('--c2') }, { values: keys.map((k) => byDay[k].s), color: css('--c3') }], { h: 180 });

  // התפלגות גרגרים בהנפקה (3 ימים)
  const bins = [['0', 0, 0], ['1', 1, 1], ['2–5', 2, 5], ['6–10', 6, 10], ['11–20', 11, 20], ['21–40', 21, 40], ['41+', 41, 1e9]];
  barChart($('dist'), bins.map((b) => b[0]),
    [{ values: bins.map((b) => a.disp.filter((r) => r.snd != null && r.snd >= b[1] && r.snd <= b[2]).length), color: css('--c3') }], { h: 180 });

  const recent = a.disp.slice(-12).reverse();
  $('recent').innerHTML = '<tr><th>מתי</th><th>ירד (ג׳)</th><th>בקערה (ג׳)</th><th>גרגרים</th><th>הצליח</th><th>ניעור</th></tr>' +
    recent.map((r) => `<tr><td>${dhm(r.t)}</td><td>${r.bowl != null ? g1(r.g) : '–'}</td><td>${r.bowl != null ? g1(r.bowl) : '–'}</td><td>${r.snd ?? '–'}</td><td style="color:${css(isOk(r) ? '--ok' : '--bad')}">${isOk(r) ? 'כן' : 'לא'}</td><td>${r.shake === 1 ? 'כן' : ''}</td></tr>`).join('');

  // תובנות של Claude (לא חובה)
  const ins = d.insights;
  if (ins && Array.isArray(ins.rows)) {
    $('insWrap').style.display = '';
    const age = ins.generated_at ? a.now - Date.parse(ins.generated_at) : null;
    $('insMeta').textContent = (ins.window ? 'תקופה: ' + ins.window : '') +
      (age != null ? ` · נכתב לפני ${dur(age)}` : '') + (age != null && age > 48 * H ? ' (ישן, ייתכן שהסוכן לא רץ)' : '');
    $('ins').innerHTML = ins.rows.map((r) => `<div class="ins"><b style="color:${css((SEV[r.severity] || SEV.notice)[0])}">${esc(r.title)}</b><span>${esc(r.detail)}</span></div>`).join('');
  }
}

function median(a) { const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function fail(e) { $('err').style.display = 'block'; $('err').textContent = 'לא הצלחתי לקרוא את הגיליון: ' + (e && e.message ? e.message : e); }

function load() {
  const api = window.PANZZI_API_URL;
  const url = api ? api : 'demo/sample-data.json';
  $('demo').style.display = api ? 'none' : 'inline-block';
  fetch(url, { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(render)
    .catch(fail);
}
load();
setInterval(load, 120000);

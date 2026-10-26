'use strict';
// Extra files for the GitHub Pages build: timetable change history and calendar subscriptions (.ics).
const fs = require('fs'), path = require('path');

const hm = (x) => { const [h, m] = String(x || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const pad2 = (n) => String(n).padStart(2, '0');
const isoD = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const addD = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoD(d); };
const wdOf = (iso) => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7; // Mon=0

// Period start/end in minutes; EduPage sometimes gives a period that overlaps the next one, clamp it.
function periodTimes(periods) {
  return periods.map((p, i) => {
    const a = hm(p.start), nx = periods[i + 1]; let b = hm(p.end);
    if (nx && b - a > 60 && hm(nx.start) > a && hm(nx.start) < b) b = hm(nx.start);
    return [a, b];
  });
}

function lookups(tt) {
  const by = (rows) => Object.fromEntries((rows || []).map((x) => [x.id, x]));
  return { subj: by(tt.subjects), teacher: by(tt.teachers), cls: by(tt.classes), room: by(tt.rooms), group: by(tt.groups) };
}

// A readable, id-independent version of a lesson (ids can change between EduPage exports).
function readable(l, tt, T, PT) {
  const P = PT || periodTimes(tt.periods), last = Math.min(l.p + l.n - 1, P.length - 1);
  const names = (ids, tab, f = 'short') => ids.map((id) => tab[id] && (tab[id][f] || tab[id].name)).filter(Boolean).sort();
  return {
    d: l.d, start: P[l.p] ? P[l.p][0] : 0, end: P[last] ? P[last][1] : 0,
    subj: (T.subj[l.s] && T.subj[l.s].name) || '?',
    teachers: names(l.t, T.teacher, 'name'), classes: names(l.c, T.cls), rooms: names(l.r, T.room),
    groups: l.g.map((id) => T.group[id]).filter((g) => g && !g.whole && g.name).map((g) => g.name).sort(),
  };
}
const sig = (x) => [x.d, x.start, x.end, x.subj, x.teachers.join(','), x.classes.join(','), x.rooms.join(','), x.groups.join(',')].join('|');

// Compare two timetables; returns null when nothing changed.
function diffTimetables(prev, next) {
  const side = (tt) => { const T = lookups(tt), PT = periodTimes(tt.periods), m = new Map(); for (const l of tt.lessons) { const x = readable(l, tt, T, PT); m.set(sig(x), x); } return m; };
  const a = side(prev), b = side(next);
  const added = [...b.keys()].filter((k) => !a.has(k)).map((k) => b.get(k));
  const removed = [...a.keys()].filter((k) => !b.has(k)).map((k) => a.get(k));
  if (!added.length && !removed.length) return null;
  const entry = { at: new Date().toISOString(), timetable: (next.timetable && next.timetable.name) || '' };
  if (added.length + removed.length > 600) return { ...entry, big: true, count: added.length + removed.length };
  return { ...entry, added, removed };
}

function updateChanges(history, prev, next, days = 45) {
  const keep = (Array.isArray(history) ? history : []).filter((e) => e && e.at && Date.now() - Date.parse(e.at) < days * 864e5);
  if (!prev || prev.stale || !next || next.stale) return { list: keep, entry: null };
  const entry = diffTimetables(prev, next);
  return { list: entry ? [...keep, entry] : keep, entry };
}

// ---------- school-free days (keep in sync with BREAKS in public/index.html) ----------
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return `${y}-${pad2(Math.floor((h + l - 7 * m + 114) / 31))}-${pad2(((h + l - 7 * m + 114) % 31) + 1)}`;
}
function holidaysOf(y) {
  const E = easter(y);
  return [`${y}-01-01`, `${y}-02-24`, addD(E, -2), E, `${y}-05-01`, addD(E, 49), `${y}-06-23`, `${y}-06-24`, `${y}-08-20`, `${y}-12-24`, `${y}-12-25`, `${y}-12-26`];
}
function breaksFromIndex(indexHtml) {
  const m = indexHtml.match(/const BREAKS = (\[[^\n]*\]);/);
  try { return m ? JSON.parse(m[1].replace(/'/g, '"')) : []; } catch (_) { return []; }
}
function offDays(from, to, breaks) {
  const s = new Set();
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) holidaysOf(y).forEach((d) => s.add(d));
  for (const [a, b] of breaks) for (let d = a; d <= b; d = addD(d, 1)) s.add(d);
  return s;
}

// ---------- calendar subscriptions ----------
const icsName = (type, id) => `${type}-${String(id).replace(/-/g, 'm').replace(/\*/g, 's').replace(/[^A-Za-z0-9_]/g, '_')}.ics`;
const tx = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) { // 75 octets per line (RFC 5545)
  const out = []; let cur = '', len = 0;
  for (const ch of line) { const n = Buffer.byteLength(ch); if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; } cur += ch; len += n; }
  out.push(cur); return out.join('\r\n ');
}
const VTZ = ['BEGIN:VTIMEZONE', 'TZID:Europe/Tallinn', 'BEGIN:STANDARD', 'DTSTART:19701025T040000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0200', 'TZNAME:EET', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD', 'BEGIN:DAYLIGHT', 'DTSTART:19700329T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0300', 'TZNAME:EEST', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT', 'END:VTIMEZONE'];

function termRange(tt) {
  const meta = tt.timetable || {}, m = String(meta.name || '').match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s*-\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  const from = meta.from || (m ? `${m[3]}-${pad2(m[2])}-${pad2(m[1])}` : isoD(new Date()));
  const to = m ? `${m[6]}-${pad2(m[5])}-${pad2(m[4])}` : addD(from, 200);
  return { from, to };
}

function buildIcs(tt, type, ent, breaks) {
  const T = lookups(tt), PT = periodTimes(tt.periods), { from, to } = termRange(tt), off = offDays(from, to, breaks);
  const key = { class: 'c', teacher: 't', room: 'r' }[type];
  const ls = tt.lessons.filter((l) => l[key].includes(ent.id));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dt = (d, m) => `${d.replace(/-/g, '')}T${pad2(Math.floor(m / 60))}${pad2(m % 60)}00`;
  const label = type === 'teacher' ? ent.name : ent.short || ent.name;
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tunniplaan//Oismae Gumnaasium//ET', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${tx(label + ' · Õismäe tunniplaan')}`, 'X-WR-TIMEZONE:Europe/Tallinn', 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H', ...VTZ];
  for (const l of ls) {
    const x = readable(l, tt, T, PT);
    let first = from; while (wdOf(first) !== l.d) first = addD(first, 1);
    if (first > to) continue;
    const ex = []; for (let d = first; d <= to; d = addD(d, 7)) if (off.has(d)) ex.push(dt(d, x.start));
    const who = type === 'teacher' ? x.classes.join(', ') : type === 'room' ? [x.classes.join(', '), x.teachers.join(', ')].filter(Boolean).join(' · ') : x.teachers.join(', ');
    const desc = who;
    const uid = `${type}-${ent.id}-${l.d}-${l.p}-${l.s}-${l.c.join('.')}-${l.g.join('.')}`.replace(/[^A-Za-z0-9.*_-]/g, '');
    out.push('BEGIN:VEVENT', `UID:${uid}@tunniplaan`, `DTSTAMP:${stamp}`, `DTSTART;TZID=Europe/Tallinn:${dt(first, x.start)}`, `DTEND;TZID=Europe/Tallinn:${dt(first, x.end)}`,
      `RRULE:FREQ=WEEKLY;UNTIL=${to.replace(/-/g, '')}T215959Z`, ...(ex.length ? [`EXDATE;TZID=Europe/Tallinn:${ex.join(',')}`] : []),
      `SUMMARY:${tx(x.subj + (x.groups.length && x.groups.join(', ') !== x.subj ? ` (${x.groups.join(', ')})` : ''))}`, ...(x.rooms.length && type !== 'room' ? [`LOCATION:${tx(x.rooms.join(', '))}`] : []),
      ...(desc ? [`DESCRIPTION:${tx(desc)}`] : []), 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.map(fold).join('\r\n') + '\r\n';
}

function writeIcsFiles(tt, dir, indexHtml) {
  const breaks = breaksFromIndex(indexHtml);
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const [type, rows] of [['class', tt.classes], ['teacher', tt.teachers], ['room', tt.rooms]]) {
    for (const e of rows || []) { fs.writeFileSync(path.join(dir, icsName(type, e.id)), buildIcs(tt, type, e, breaks)); n++; }
  }
  return { files: n, breaks: breaks.length };
}

module.exports = { diffTimetables, updateChanges, buildIcs, writeIcsFiles, icsName, termRange, offDays, breaksFromIndex, periodTimes };

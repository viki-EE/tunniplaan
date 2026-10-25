#!/usr/bin/env node
// Õismäe timetable — zero-dependency scraper + server.
// Usage:  node server.js            (then open http://localhost:3000)
// Env:    SCHOOL=oismae  PORT=3000  YEAR=2026  EDUPAGE_BASE=https://oismae.edupage.org
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const SCHOOL = process.env.SCHOOL || 'oismae';
const BASE = (process.env.EDUPAGE_BASE || `https://${SCHOOL}.edupage.org`).replace(/\/$/, '');
const PORT = Number(process.env.PORT || 3000);
// Localhost only by default. To share on your network (events are writable!): HOST=0.0.0.0 node server.js
const HOST = process.env.HOST || '127.0.0.1';
const TTL_MS = 10 * 60 * 1000;
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || __dirname;

// School year starts in September: Jan–Aug belongs to the previous year's timetable.
function schoolYear(d = new Date()) {
  return Number(process.env.YEAR) || (d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
let session = { cookie: '', gsh: null, pageYear: null };

// Load the real page once: collect cookies + EduPage's "gsh" token + the year the page itself uses.
async function bootstrap() {
  try {
    const res = await fetch(`${BASE}/timetable/`, { headers: { 'User-Agent': UA, 'Accept-Language': 'et,en;q=0.8' } });
    const html = await res.text();
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    session.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const g = html.match(/gsh["']?\s*[:=]\s*["']([0-9a-fA-F]{6,16})["']/);
    session.gsh = g ? g[1] : null;
    const y = html.match(/ttviewer[\s\S]{0,400}?(20\d\d)/) || html.match(/["']year["']\s*:\s*(20\d\d)/);
    session.pageYear = y ? Number(y[1]) : null;
  } catch (_) { /* fall through with defaults */ }
}

const attempts = [];
let rawPeriods = [];
async function edupost(file, func, args, gsh) {
  const body = { __args: args, __gpdata: 'null' };
  if (gsh) body.__gsh = gsh;
  const res = await fetch(`${BASE}/timetable/server/${file}?__func=${func}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': UA,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Origin: BASE,
      Referer: `${BASE}/timetable/`,
      'X-Requested-With': 'XMLHttpRequest',
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  attempts.push({ func, args, gsh: gsh || null, http: res.status, reload: !!(json && json.reload), snippet: text.slice(0, 160) });
  if (!res.ok) throw new Error(`EduPage ${func} → HTTP ${res.status}`);
  if (!json) throw new Error(`EduPage ${func} returned non-JSON: ${text.slice(0, 80)}`);
  if (json.reload) { const e = new Error('reload'); e.reload = true; throw e; }
  return json.r || json;
}

// Try the likely year / token combinations until EduPage stops asking for a reload.
async function getRoot() {
  await bootstrap();
  const y = schoolYear();
  const years = [...new Set([session.pageYear, y, y - 1, y + 1].filter(Boolean))];
  const gshs = [...new Set([session.gsh, '00000000'].filter(Boolean)), null];
  let last;
  for (const year of years) for (const gsh of gshs) {
    try { return { root: await edupost('ttviewer.js', 'getTTViewerData', [null, year], gsh), year, gsh }; }
    catch (e) { last = e; if (!e.reload) throw e; }
  }
  throw new Error('EduPage keeps answering "reload" for every year/token combination I tried. Details at /api/debug');
}

const tablesOf = (r) => {
  const t = (r && r.dbiAccessorRes && r.dbiAccessorRes.tables) || [];
  const out = {};
  for (const tb of t) out[tb.id] = tb.data_rows || [];
  return out;
};
const byId = (rows) => Object.fromEntries((rows || []).map((x) => [x.id, x]));
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// "10100" -> [0,2]  (Mon..Fri bit string)
function dayIdxs(days) {
  if (typeof days === 'number') days = days.toString(2);
  return String(days || '').split('').map((c, i) => (c === '1' ? i : -1)).filter((i) => i >= 0);
}

function normalize(tables, meta) {
  const periods = (tables.periods || [])
    .map((p) => ({ id: String(p.id), name: p.name || p.short || String(p.id), start: p.starttime, end: p.endtime }))
    .sort((a, b) => (a.start || '').localeCompare(b.start || '', undefined, { numeric: true }));
  const hm = (x) => { const [h, m] = String(x || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  const pad = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  periods.forEach((p, i) => {
    const nx = periods[i + 1], a = hm(p.start), b = hm(p.end);
    if (nx && b - a > 60 && hm(nx.start) > a && hm(nx.start) < b) { p.rawEnd = p.end; p.end = pad(hm(nx.start)); }
  });
  const periodIdx = Object.fromEntries(periods.map((p, i) => [p.id, i]));

  const lessons = byId(tables.lessons);
  const mk = (rows) => (rows || [])
    .map((x) => ({ id: String(x.id), name: x.name || x.short || '', short: x.short || x.name || '' }))
    .sort((a, b) => String(a.short).localeCompare(String(b.short), undefined, { numeric: true }));
  const groups = (tables.groups || []).map((g) => ({
    id: String(g.id), name: g.name || g.short || '', classId: g.classid ? String(g.classid) : null, whole: !!g.entireclass,
  }));

  // Lessons reference things by id only; names live in the lookup tables (smaller, and lets the UI link everything).
  const seen = new Set();
  const out = [];
  for (const card of tables.cards || []) {
    const l = lessons[card.lessonid];
    if (!l) continue;
    const p = periodIdx[String(card.period)];
    if (p === undefined) continue;
    const n = Math.max(1, Number(l.durationperiods || 1));
    const t = arr(l.teacherids).map(String).sort();
    const c = arr(l.classids).map(String).sort();
    const g = arr(l.groupids).map(String).sort();
    const r = arr(card.classroomids).map(String).sort();
    for (const d of dayIdxs(card.days)) {
      const key = [d, p, n, l.subjectid, t, c, g, r, card.weeks].join('|');
      if (seen.has(key)) continue; // identical duplicate cards
      seen.add(key);
      out.push({ d, p, n, s: String(l.subjectid), t, c, g, r, w: card.weeks ? String(card.weeks) : '' });
    }
  }

  return {
    school: SCHOOL,
    fetchedAt: new Date().toISOString(),
    timetable: meta,
    periods,
    subjects: mk(tables.subjects),
    teachers: mk(tables.teachers),
    classes: mk(tables.classes),
    rooms: mk(tables.classrooms),
    groups,
    lessons: out,
  };
}

const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
let cache = { at: 0, data: null };
async function load(force) {
  if (!force && cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
  try { return await fetchFresh(); }
  catch (e) {
    // EduPage unreachable → serve the last good copy from disk so the app still works offline
    try {
      const old = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      return { ...old, stale: true, staleReason: String(e.message || e) };
    } catch (_) { throw e; }
  }
}
async function fetchFresh() {
  attempts.length = 0;
  const { root, year, gsh } = await getRoot();
  const list = (root.regular && root.regular.timetables) || [];
  let pick = null;
  if (list.length) {
    // latest timetable that has already started, else the newest
    const today = new Date().toISOString().slice(0, 10);
    const started = list.filter((t) => !t.datefrom || t.datefrom <= today);
    pick = (started.length ? started : list).sort((a, b) => String(a.datefrom || '').localeCompare(String(b.datefrom || ''))).pop();
  }
  let tables;
  if (pick) {
    const r = await edupost('regulartt.js', 'regularttGetData', [null, String(pick.tt_num)], gsh);
    tables = tablesOf(r);
    rawPeriods = tables.periods || [];
  } else {
    tables = tablesOf(root); // some schools inline the data
  }
  const data = normalize(tables, pick ? { id: pick.tt_num, name: pick.text, from: pick.datefrom, year } : { year });
  cache = { at: Date.now(), data };
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data)); } catch (_) {}
  return data;
}


// ---------- shared school-event tracker (stored in events.json next to this file) ----------
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const readEvents = () => { try { const a = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
function mergeEvents(a, b) {
  const m = new Map();
  for (const e of [...a, ...b]) {
    if (!e || typeof e.id !== 'string') continue;
    const o = m.get(e.id);
    if (!o || (Number(e.updatedAt) || 0) >= (Number(o.updatedAt) || 0)) m.set(e.id, e);
  }
  const cutoff = Date.now() - 90 * 86400000; // forget old tombstones
  return [...m.values()].filter((e) => !(e.deleted && (Number(e.updatedAt) || 0) < cutoff)).slice(0, 5000);
}
const cleanEvent = (e) => e && typeof e.id === 'string' && e.id.length < 64 ? (e.deleted
  ? { id: e.id, deleted: true, updatedAt: Number(e.updatedAt) || 0 }
  : {
    id: e.id, title: String(e.title || '').slice(0, 200), type: String(e.type || 'other').slice(0, 20),
    date: String(e.date || '').slice(0, 10), end: e.end ? String(e.end).slice(0, 10) : '', time: e.time ? String(e.time).slice(0, 5) : '',
    target: e.target && typeof e.target.type === 'string' ? { type: String(e.target.type).slice(0, 12), id: String(e.target.id).slice(0, 64) } : null,
    note: String(e.note || '').slice(0, 1000), done: !!e.done, remind: !!e.remind, updatedAt: Number(e.updatedAt) || Date.now(),
  }) : null;
function readBody(req, limit = 1e6) {
  return new Promise((ok, bad) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > limit) { bad(new Error('too large')); req.destroy(); } });
    req.on('end', () => ok(b));
    req.on('error', bad);
  });
}

// ---------- geocoding (Nominatim), bus routing (Peatus.ee OpenTripPlanner), weather (Open-Meteo) ----------
const GEOCODE_BASE = (process.env.GEOCODE_BASE || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const OTP_URL = process.env.OTP_URL || 'https://api.peatus.ee/routing/v1/routers/estonia/index/graphql';
const WEATHER_BASE = (process.env.WEATHER_BASE || 'https://api.open-meteo.com').replace(/\/$/, '');
const SCHOOL_ADDRESS = process.env.SCHOOL_ADDRESS || 'Õismäe tee 50, Tallinn';
const GEO_GAP = Number(process.env.GEO_GAP ?? 1100); // Nominatim policy: max 1 request/second
const FALLBACK_LOC = { lat: 59.4108, lon: 24.6528 }; // approximate Õismäe, used only if geocoding the school fails
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP_UA = 'OismaeTimetable/1.0 (personal school timetable viewer)';

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': APP_UA, Accept: 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  if (!res.ok) throw new Error(`${new URL(url).host} → HTTP ${res.status}`);
  if (json === null) throw new Error(`${new URL(url).host} returned non-JSON`);
  return json;
}

const geoCache = new Map();
let geoChain = Promise.resolve();
function geocode(q) {
  const key = q.trim().toLowerCase();
  if (geoCache.has(key)) return Promise.resolve(geoCache.get(key));
  const url = `${GEOCODE_BASE}/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&countrycodes=ee&accept-language=et&viewbox=24.45,59.55,25.05,59.30`;
  const run = geoChain.then(async () => { const r = await getJson(url); await sleep(GEO_GAP); return r; });
  geoChain = run.catch(() => {});
  return run.then((rows) => {
    const out = (Array.isArray(rows) ? rows : []).map((r) => ({
      label: String(r.display_name || '').split(',').slice(0, 3).join(',').trim(), lat: Number(r.lat), lon: Number(r.lon),
    })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    geoCache.set(key, out);
    return out;
  });
}

let schoolLoc = null;
async function getSchool() {
  if (schoolLoc) return schoolLoc;
  if (process.env.SCHOOL_LAT && process.env.SCHOOL_LON) return (schoolLoc = { lat: Number(process.env.SCHOOL_LAT), lon: Number(process.env.SCHOOL_LON), address: SCHOOL_ADDRESS });
  try { const r = await geocode(SCHOOL_ADDRESS); if (r[0]) return (schoolLoc = { lat: r[0].lat, lon: r[0].lon, address: SCHOOL_ADDRESS }); } catch (_) {}
  return { ...FALLBACK_LOC, address: SCHOOL_ADDRESS, approx: true };
}

const lastTransit = { at: null, http: null, query: null, snippet: null };

async function otpQuery(query) {
  const res = await fetch(OTP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': APP_UA }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(25000) });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch (_) {}
  Object.assign(lastTransit, { at: new Date().toISOString(), http: res.status, query: query.slice(0, 400), snippet: text.slice(0, 400) });
  const gqlErr = j && j.errors && j.errors.length ? j.errors.map((e) => e.message).join('; ') : '';
  if (!res.ok) throw new Error(`peatus.ee → HTTP ${res.status}${gqlErr ? ': ' + gqlErr : ''}`);
  if (gqlErr && !(j && j.data)) throw new Error('peatus.ee: ' + gqlErr);
  return (j && j.data) || {};
}
async function otpPlan(from, to, date, time, arriveBy) {
  // peatus.ee (OTP 1.x) wants HH:MM:SS; HH:MM makes it answer HTTP 500.
  const hms = /^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, '0') + ':00' : time;
  const legF = ['mode startTime endTime duration distance from{name stop{code}} to{name stop{code}} trip{tripHeadsign} route{shortName}', 'mode startTime endTime duration distance from{name} to{name} route{shortName}'];
  let lastErr = new Error('no response');
  for (const lf of legF) {
    try {
      const d = await otpQuery(`{plan(from:{lat:${from.lat},lon:${from.lon}},to:{lat:${to.lat},lon:${to.lon}},date:"${date}",time:"${hms}",arriveBy:${arriveBy},numItineraries:6){itineraries{startTime endTime duration walkDistance legs{${lf}}}}}`);
      if (d.plan) return d.plan.itineraries || [];
      lastErr = new Error('unexpected response from peatus.ee');
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Departure board for the stops next to school (names from STOP_NAMES).
const STOP_NAMES = (process.env.STOP_NAMES || 'Kullerkupu,Meelespea,Rukkilille').split(',').map((x) => x.trim()).filter(Boolean);
let nearStops = null;
const distM = (a, b) => { const R = 6371e3, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
async function getNearStops() {
  if (nearStops) return nearStops;
  const school = await getSchool();
  const q = '{' + STOP_NAMES.map((n, i) => `s${i}:stops(name:${JSON.stringify(n)}){gtfsId name code lat lon}`).join(' ') + '}';
  const d = await otpQuery(q);
  const out = [];
  STOP_NAMES.forEach((n, i) => (d['s' + i] || []).forEach((st) => {
    const dist = Math.round(distM(school, st));
    if (dist <= 1500 && st.name.toLowerCase().startsWith(n.toLowerCase())) out.push({ id: st.gtfsId, name: st.name, code: st.code || '', lat: st.lat, lon: st.lon, dist });
  }));
  out.sort((a, b) => a.name.localeCompare(b.name) || a.dist - b.dist);
  if (out.length) nearStops = out;
  return out;
}
const depCache = new Map();
async function getDepartures(at) {
  const key = String(at || 'now');
  const hit = depCache.get(key);
  if (hit && Date.now() - hit.at < 30e3) return hit.v;
  const stops = await getNearStops();
  if (!stops.length) return { stops: [] };
  const st = at ? `,startTime:${Math.floor(at)}` : '';
  const mkq = (f) => '{' + stops.map((s, i) => `s${i}:stop(id:${JSON.stringify(s.id)}){stoptimesWithoutPatterns(numberOfDepartures:8${st}){scheduledDeparture realtimeDeparture realtime ${f} headsign trip{route{shortName mode}}}}`).join(' ') + '}';
  let d;
  try { d = await otpQuery(mkq('serviceDay')); }
  catch (e) { // older OTP without serviceDay: assume the service day starts at local midnight of the requested day
    d = await otpQuery(mkq(''));
    const base = new Date(at ? at * 1000 : Date.now()), offMin = (new Date(base.toLocaleString('en-US', { timeZone: 'Europe/Tallinn' })) - new Date(base.toLocaleString('en-US', { timeZone: 'UTC' }))) / 60000, mid = Math.floor(Date.parse(base.toLocaleDateString('en-CA', { timeZone: 'Europe/Tallinn' }) + 'T00:00:00Z') / 1000) - offMin * 60;
    Object.values(d).forEach((x) => ((x && x.stoptimesWithoutPatterns) || []).forEach((y) => { y.serviceDay = mid; }));
  }
  const v = {
    fetchedAt: new Date().toISOString(),
    stops: stops.map((s, i) => ({
      ...s,
      deps: (((d['s' + i] || {}).stoptimesWithoutPatterns) || []).map((x) => ({
        at: ((x.serviceDay || 0) + (x.realtimeDeparture ?? x.scheduledDeparture)) * 1000,
        sched: ((x.serviceDay || 0) + x.scheduledDeparture) * 1000,
        live: !!x.realtime, headsign: x.headsign || '', route: (x.trip && x.trip.route && x.trip.route.shortName) || '', mode: (x.trip && x.trip.route && x.trip.route.mode) || 'BUS',
      })),
    })),
  };
  if (depCache.size > 50) depCache.clear();
  depCache.set(key, { at: Date.now(), v });
  return v;
}
const num = (x) => Number(x) || 0;
function normItin(it) {
  const legs = (it.legs || []).map((l) => ({
    mode: String(l.mode || ''), route: (l.route && l.route.shortName) || '', headsign: (l.trip && l.trip.tripHeadsign) || l.headsign || '',
    from: (l.from && l.from.name) || '', to: (l.to && l.to.name) || '', start: num(l.startTime), end: num(l.endTime),
    min: Math.max(1, Math.round(num(l.duration) / 60)), dist: Math.round(num(l.distance)),
  }));
  const transit = legs.filter((l) => l.mode !== 'WALK');
  return {
    start: num(it.startTime), end: num(it.endTime), min: Math.max(1, Math.round(num(it.duration) / 60)),
    walkMin: legs.filter((l) => l.mode === 'WALK').reduce((a, l) => a + (l.dist < 30 && l.min <= 1 ? 0 : l.min), 0),
    transfers: Math.max(0, transit.length - 1), legs,
  };
}

const weatherCache = { at: 0, data: null };
async function getWeather(force) {
  if (!force && weatherCache.data && Date.now() - weatherCache.at < 15 * 60e3) return weatherCache.data;
  try {
    const s = await getSchool();
    const u = `${WEATHER_BASE}/v1/forecast?latitude=${s.lat}&longitude=${s.lon}` +
      '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,weather_code,wind_speed_10m,wind_gusts_10m,uv_index' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset' +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=Europe%2FTallinn&forecast_days=8&wind_speed_unit=ms';
    const j = await getJson(u);
    const h = j.hourly || {}, d = j.daily || {}, c = j.current || {};
    const hourly = (h.time || []).map((t, i) => ({
      t, temp: h.temperature_2m[i], feels: h.apparent_temperature[i], pop: h.precipitation_probability ? h.precipitation_probability[i] : 0,
      precip: h.precipitation[i], snow: h.snowfall ? h.snowfall[i] : 0, code: h.weather_code[i], wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m ? h.wind_gusts_10m[i] : h.wind_speed_10m[i], uv: h.uv_index ? h.uv_index[i] : 0,
    }));
    const daily = (d.time || []).map((t, i) => ({ date: t, code: d.weather_code[i], tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], sunrise: d.sunrise[i], sunset: d.sunset[i] }));
    const data = { fetchedAt: new Date().toISOString(), loc: { lat: s.lat, lon: s.lon }, current: c.time ? { temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, wind: c.wind_speed_10m } : null, hourly, daily };
    weatherCache.at = Date.now(); weatherCache.data = data;
    return data;
  } catch (e) { if (weatherCache.data) return { ...weatherCache.data, stale: true }; throw e; }
}
const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
async function handleApi(url, res) {
  try {
    if (url.pathname === '/api/geocode') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 3 || q.length > 200) return sendJson(res, 400, { error: 'query too short' });
      return sendJson(res, 200, await geocode(q));
    }
    if (url.pathname === '/api/weather') return sendJson(res, 200, await getWeather(url.searchParams.has('refresh')));
    if (url.pathname === '/api/departures') { const at = Number(url.searchParams.get('at')) || 0; return sendJson(res, 200, await getDepartures(at > 1e9 ? at : 0)); }
    if (url.pathname === '/api/route') {
      const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
      const dir = url.searchParams.get('dir') === 'from' ? 'from' : 'to';
      const date = url.searchParams.get('date') || '', time = url.searchParams.get('time') || '';
      if (!(lat > 57 && lat < 60.5 && lon > 21 && lon < 29)) return sendJson(res, 400, { error: 'home location must be in Estonia' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return sendJson(res, 400, { error: 'bad date/time' });
      const school = await getSchool(), home = { lat, lon }, toSchool = dir === 'to';
      const its = (await otpPlan(toSchool ? home : school, toSchool ? school : home, date, time, toSchool)).map(normItin).filter((i) => i.legs.length);
      its.sort(toSchool ? (a, b) => b.start - a.start : (a, b) => a.end - b.end);
      return sendJson(res, 200, { dir, date, time, school, itineraries: its.slice(0, 5) });
    }
  } catch (e) { return sendJson(res, 502, { error: String(e.message || e) }); }
  return sendJson(res, 404, { error: 'not found' });
}

function lanUrls() {
  const out = [];
  for (const [name, list] of Object.entries(require('os').networkInterfaces())) for (const i of list || []) {
    if (i.family !== 'IPv4' && i.family !== 4) continue; if (i.internal) continue;
    if (/vEthernet|virtual|vmware|vbox|docker|wsl|hyper-v/i.test(name)) continue;
    out.push(`http://${i.address}:${PORT}`);
  }
  return out.sort((a, b) => (/\/\/192\.168\./.test(b) ? 1 : 0) - (/\/\/192\.168\./.test(a) ? 1 : 0));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (['/api/geocode', '/api/weather', '/api/route', '/api/departures'].includes(url.pathname)) return handleApi(url, res);
  if (url.pathname === '/api/lan') return sendJson(res, 200, { shared: HOST !== '127.0.0.1' && HOST !== 'localhost', port: PORT, urls: lanUrls() });
  if (url.pathname === '/api/debug') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ base: BASE, session: { ...session, cookie: session.cookie ? '(set)' : '' }, periods: rawPeriods, attempts, lastTransit }, null, 2));
  }
  if (url.pathname === '/api/events') {
    try {
      if (req.method === 'PUT' || req.method === 'POST') {
        const incoming = JSON.parse((await readBody(req)) || '[]');
        if (!Array.isArray(incoming)) throw new Error('expected an array');
        const merged = mergeEvents(readEvents(), incoming.map(cleanEvent).filter(Boolean));
        fs.writeFileSync(EVENTS_FILE, JSON.stringify(merged));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(merged));
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(readEvents()));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }
  if (url.pathname === '/api/timetable') {
    try {
      const data = await load(url.searchParams.has('refresh'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }
  let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Timetable running → http://localhost:${PORT}  (source: ${BASE})`);
    if (HOST !== '127.0.0.1' && HOST !== 'localhost') { console.log('On your phone (same Wi-Fi):'); lanUrls().forEach((u) => console.log('   ' + u)); }
  });
}
module.exports = { normalize, tablesOf, dayIdxs, mergeEvents, normItin, server, fetchFresh, getSchool, getNearStops };

'use strict';
// Fake EduPage serving the same JSON shapes the real one does (verified against /api/debug output).
const http = require('http');

const tables = [
  { id: 'periods', data_rows: [
    { id: '1', name: '1', starttime: '8:00', endtime: '8:45' },
    { id: '2', name: '2', starttime: '8:55', endtime: '9:40' },
    { id: '3', name: '3', starttime: '9:50', endtime: '10:35' }] },
  { id: 'subjects', data_rows: [
    { id: 's1', name: 'Matemaatika', short: 'MAT' }, { id: 's2', name: 'Eesti keel', short: 'EK' }, { id: 's3', name: 'Liikumisõpetus', short: 'LIIK' }] },
  { id: 'teachers', data_rows: [
    { id: 't1', name: 'Mari Tamm', short: 'TaM' }, { id: 't2', name: 'Rea Lillemets', short: 'LiR' }, { id: 't3', name: 'Sten Kaldma', short: 'KaS' }] },
  { id: 'classes', data_rows: [
    { id: 'c1', name: '10A', short: '10A' }, { id: 'c2', name: '10B', short: '10B' }, { id: 'c3', name: '10C', short: '10C' }] },
  { id: 'classrooms', data_rows: [
    { id: 'r1', name: '101', short: '101' }, { id: 'r2', name: '126A', short: '126A' }, { id: 'r3', name: '001', short: '001' }] },
  { id: 'groups', data_rows: [
    // gym groups: one per class, ALL named the same (this caused "Tüdrukud, Tüdrukud, Tüdrukud")
    { id: 'g1', name: 'Tüdrukud', classid: 'c1', entireclass: false },
    { id: 'g2', name: 'Tüdrukud', classid: 'c2', entireclass: false },
    { id: 'g3', name: 'Tüdrukud', classid: 'c3', entireclass: false },
    { id: 'b1', name: 'Poisid', classid: 'c1', entireclass: false },
    { id: 'b2', name: 'Poisid', classid: 'c2', entireclass: false },
    { id: 'b3', name: 'Poisid', classid: 'c3', entireclass: false },
    { id: 'all1', name: 'Terve klass', classid: 'c1', entireclass: true }] },
  { id: 'lessons', data_rows: [
    { id: 'l1', subjectid: 's1', teacherids: ['t1'], classids: ['c1'], groupids: ['all1'], durationperiods: 2 },
    { id: 'l2', subjectid: 's2', teacherids: ['t1'], classids: ['c1'], groupids: [], durationperiods: 1 },
    { id: 'l3', subjectid: 's3', teacherids: ['t2'], classids: ['c1', 'c2', 'c3'], groupids: ['g1', 'g2', 'g3'], durationperiods: 1 },
    { id: 'l4', subjectid: 's3', teacherids: ['t3'], classids: ['c1', 'c2', 'c3'], groupids: ['b1', 'b2', 'b3'], durationperiods: 1 },
    { id: 'l5', subjectid: 's2', teacherids: ['t1'], classids: ['c2'], groupids: [], durationperiods: 1 }] },
  { id: 'cards', data_rows: [
    { lessonid: 'l1', period: '1', days: '10100', weeks: '11', classroomids: ['r1'] },
    { lessonid: 'l1', period: '1', days: '10100', weeks: '11', classroomids: ['r1'] }, // exact duplicate → must be deduped
    { lessonid: 'l2', period: '3', days: '01000', weeks: '11', classroomids: ['r1'] },
    { lessonid: 'l3', period: '3', days: '00100', weeks: '11', classroomids: ['r2'] },
    { lessonid: 'l4', period: '3', days: '00100', weeks: '11', classroomids: ['r3'] },
    { lessonid: 'l5', period: '1', days: '00100', weeks: '11', classroomids: ['r2'] },
    { lessonid: 'l5', period: '2', days: '00100', weeks: '11', classroomids: ['r2'] }] },
];

function startMock() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed = {}; try { parsed = JSON.parse(body || '{}'); } catch (_) {}
      calls.push({ url: req.url, body: parsed });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('getTTViewerData')) {
        // Like the real thing: without the 00000000 token EduPage says {"reload":true}
        if (parsed.__gsh !== '00000000') return res.end(JSON.stringify({ reload: true }));
        return res.end(JSON.stringify({ r: { regular: { default_num: '9', timetables: [
          { tt_num: '5', text: 'Old', datefrom: '2026-09-01' },
          { tt_num: '9', text: 'Autumn v2', datefrom: '2026-10-01' },
          { tt_num: '12', text: 'Future', datefrom: '2027-01-01' }] } } }));
      }
      if (req.url.includes('regularttGetData')) return res.end(JSON.stringify({ r: { dbiAccessorRes: { tables } } }));
      if (req.url.startsWith('/search')) { res.end(JSON.stringify([{ display_name: 'Õismäe tee 12, Haabersti, Tallinn, Estonia', lat: '59.41', lon: '24.65' }])); return; }
      if (req.url.startsWith('/otp')) {
        const q = String(parsed.query || '');
        if (q.includes('stops(name:')) { // stop search: one nearby + one far away with the same name
          const out = {}; (q.match(/s\d+:stops/g) || []).forEach((k, i) => { out['s' + i] = [{ gtfsId: '1:' + (100 + i), name: ['Kullerkupu', 'Meelespea', 'Rukkilille'][i], code: '7' + i, lat: 59.401 + i * 0.001, lon: 24.651 }, { gtfsId: '9:' + i, name: 'Kullerkupu', code: '', lat: 58.3, lon: 26.7 }]; });
          res.end(JSON.stringify({ data: out })); return;
        }
        if (q.includes('stop(id:')) {
          const sd = Math.floor(Date.parse('2026-10-21T00:00:00+03:00') / 1000), out = {};
          (q.match(/s\d+:stop\(/g) || []).forEach((k, i) => { out['s' + i] = { stoptimesWithoutPatterns: [{ scheduledDeparture: 9 * 3600 + 300, realtimeDeparture: 9 * 3600 + 420, realtime: true, serviceDay: sd, headsign: 'Balti jaam', trip: { route: { shortName: '2' + i, mode: 'BUS' } } }, { scheduledDeparture: 9 * 3600 + 1800, realtimeDeparture: 9 * 3600 + 1800, realtime: false, serviceDay: sd, headsign: 'Väike-Õismäe', trip: { route: { shortName: '4' + i, mode: 'BUS' } } }] }; });
          res.end(JSON.stringify({ data: out })); return;
        }
        if (!/time:"\d\d:\d\d:\d\d"/.test(q)) { res.statusCode = 500; res.end(JSON.stringify({ errors: [{ message: 'bad time' }] })); return; } // like peatus.ee
        const T = (hm) => Date.parse('2026-10-21T' + hm + ':00+03:00');
        const it = (a, b, route) => ({ startTime: T(a), endTime: T(b), duration: (T(b) - T(a)) / 1000, legs: [
          { mode: 'WALK', startTime: T(a), endTime: T(a) + 240000, duration: 240, distance: 300, from: { name: 'Origin' }, to: { name: 'Stop A' }, route: null },
          { mode: 'BUS', startTime: T(a) + 300000, endTime: T(b) - 120000, duration: 1200, distance: 5000, headsign: 'Õismäe', from: { name: 'Stop A' }, to: { name: 'Stop B' }, route: { shortName: route }, trip: { tripHeadsign: 'Õismäe' } }] });
        res.end(JSON.stringify({ data: { plan: { itineraries: [it('07:40', '08:05', '36'), it('07:25', '07:50', '33'), it('07:10', '07:35', '21')] } } })); return;
      }
      if (req.url.startsWith('/v1/forecast')) {
        const time = [], H = { temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [], snowfall: [], weather_code: [], wind_speed_10m: [], wind_gusts_10m: [], uv_index: [] };
        for (const day of ['2026-10-21', '2026-10-22']) for (let h = 0; h < 24; h++) { time.push(`${day}T${String(h).padStart(2, '0')}:00`); H.temperature_2m.push(-1); H.apparent_temperature.push(-5); H.precipitation_probability.push(70); H.precipitation.push(0.4); H.snowfall.push(0); H.weather_code.push(61); H.wind_speed_10m.push(5); H.wind_gusts_10m.push(8); H.uv_index.push(0); }
        res.end(JSON.stringify({ hourly: { time, ...H }, daily: { time: ['2026-10-21', '2026-10-22'], weather_code: [61, 3], temperature_2m_max: [2, 3], temperature_2m_min: [-3, -2], sunrise: ['2026-10-21T07:40', '2026-10-22T07:42'], sunset: ['2026-10-21T17:50', '2026-10-22T17:48'] }, current: { time: '2026-10-21T09:00', temperature_2m: 0, apparent_temperature: -3, weather_code: 61, wind_speed_10m: 5 } })); return;
      }
      if (req.url.startsWith('/timetable/') && req.method === 'GET') { res.setHeader('Content-Type', 'text/html'); return res.end('<html></html>'); }
      res.statusCode = 404; res.end('{}');
    });
  });
  return new Promise((ok) => server.listen(0, () => ok({ server, calls, port: server.address().port })));
}
const setEnv = (port) => {
  Object.assign(process.env, { EDUPAGE_BASE: `http://127.0.0.1:${port}`, GEOCODE_BASE: `http://127.0.0.1:${port}`, OTP_URL: `http://127.0.0.1:${port}/otp`, WEATHER_BASE: `http://127.0.0.1:${port}`, SCHOOL_LAT: '59.40', SCHOOL_LON: '24.65', GEO_GAP: '0', PORT: '0', DATA_DIR: require('fs').mkdtempSync(require('os').tmpdir() + '/oismae-test-') });
};
module.exports = { startMock, setEnv };

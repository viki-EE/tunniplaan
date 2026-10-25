'use strict';
const assert = require('assert');
const { startMock, setEnv } = require('./mock');
(async () => {
  const m = await startMock();
  setEnv(m.port);
  const { server } = require('../server.js');
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(`${base}/api/timetable`); const d = await r.json();
    assert.equal(r.status, 200);
    assert.equal(d.timetable.id, '9', 'latest already-started timetable');
    assert.equal(d.periods.length, 3);
    assert.equal(d.lessons.length, 7, 'l1 Mon+Wed (dup removed) + l2 + l3 + l4 + 2x l5');
    const mon = d.lessons.find((l) => l.d === 0);
    assert.deepEqual([mon.n, mon.t, mon.c, mon.r, mon.s], [2, ['t1'], ['c1'], ['r1'], 's1']);
    assert.equal(d.groups.find((g) => g.id === 'g2').classId, 'c2');
    assert.equal(d.groups.find((g) => g.id === 'all1').whole, true);
    assert.equal(d.teachers.find((t) => t.id === 't2').name, 'Rea Lillemets');
    assert.ok(m.calls.some((c) => c.body.__gsh === '00000000'), 'retried with the 00000000 token after reload');
    assert.equal((await fetch(`${base}/api/debug`)).status, 200);
    const w = await (await fetch(`${base}/api/weather`)).json(); assert.equal(w.daily.length, 2); assert.equal(w.hourly[0].feels, -5);
    const g = await (await fetch(`${base}/api/geocode?q=Oismae`)).json(); assert.equal(g[0].lat, 59.41);
    const rt = await (await fetch(`${base}/api/route?lat=59.41&lon=24.65&dir=to&date=2026-10-21&time=07:55`)).json(); assert.equal(rt.itineraries.length, 3); assert.equal(rt.itineraries[0].legs[1].route, '36');
    assert.equal((await fetch(`${base}/api/route?lat=1&lon=1&date=x&time=y`)).status, 400);
    assert.equal(rt.itineraries[0].legs[1].headsign, 'Õismäe', 'headsign via trip.tripHeadsign');
    const dep = await (await fetch(`${base}/api/departures`)).json();
    assert.equal(dep.stops.length, 3, 'only stops near school (far namesake filtered)'); assert.equal(dep.stops[0].deps[0].route, '20'); assert.ok(dep.stops[0].deps[0].live);
    assert.equal(dep.stops[0].deps[0].at, Date.parse('2026-10-21T09:07:00+03:00'));
    console.log('PASS api: scrape → normalize (ids+lookups, groups, dedupe, gsh retry)');
  } catch (e) { console.error('FAIL api', e); process.exitCode = 1; }
  server.close(); m.server.close();
})();

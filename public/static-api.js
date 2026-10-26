// Static (GitHub Pages) mode: answers the app's /api/* calls in the browser instead of a Node server.
(function () {
  'use strict';
  window.STATIC = true;
  const realFetch = window.fetch.bind(window);
  const OTP = 'https://api.peatus.ee/routing/v1/routers/estonia/index/graphql';
  let META = null;
  const meta = () => (META = META || realFetch('data/meta.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => ({ school: { lat: 59.4108, lon: 24.6528 }, stops: [] })));
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  async function getJson(u) { const r = await realFetch(u); if (!r.ok) throw new Error(new URL(u).host + ' → HTTP ' + r.status); return r.json(); }
  async function otp(query) {
    const r = await realFetch(OTP, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    let j = null; try { j = await r.json(); } catch (_) {}
    const ge = j && j.errors && j.errors.length ? j.errors.map((e) => e.message).join('; ') : '';
    if (!r.ok) throw new Error('peatus.ee → HTTP ' + r.status + (ge ? ': ' + ge : ''));
    if (ge && !(j && j.data)) throw new Error('peatus.ee: ' + ge);
    return (j && j.data) || {};
  }
  const num = (x) => Number(x) || 0;
  function normItin(it) {
    const legs = (it.legs || []).map((l) => ({ mode: String(l.mode || ''), route: (l.route && l.route.shortName) || '', headsign: (l.trip && l.trip.tripHeadsign) || '', from: (l.from && l.from.name) || '', to: (l.to && l.to.name) || '', start: num(l.startTime), end: num(l.endTime), min: Math.max(1, Math.round(num(l.duration) / 60)), dist: Math.round(num(l.distance)) }));
    const transit = legs.filter((l) => l.mode !== 'WALK');
    return { start: num(it.startTime), end: num(it.endTime), min: Math.max(1, Math.round(num(it.duration) / 60)), walkMin: legs.filter((l) => l.mode === 'WALK').reduce((a, l) => a + (l.dist < 30 && l.min <= 1 ? 0 : l.min), 0), transfers: Math.max(0, transit.length - 1), legs };
  }
  const H = {
    async timetable() { const r = await realFetch('data/timetable.json', { cache: 'no-cache' }); return json(await r.json(), r.status); },
    async events(u, init) {
      if (init && /PUT|POST/i.test(init.method || '')) return json(JSON.parse(init.body || '[]')); // saved only on this device
      try { const r = await realFetch('data/events.json', { cache: 'no-cache' }); return json(r.ok ? await r.json() : []); } catch (_) { return json([]); }
    },
    async lan() { return json({ shared: false, static: true, urls: [] }); },
    async geocode(u) {
      const q = (u.searchParams.get('q') || '').trim(); if (q.length < 3) return json({ error: 'query too short' }, 400);
      const rows = await getJson('https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(q) + '&format=jsonv2&limit=6&countrycodes=ee&accept-language=et&viewbox=24.45,59.55,25.05,59.30');
      return json((rows || []).map((r) => ({ label: String(r.display_name || '').split(',').slice(0, 3).join(',').trim(), lat: Number(r.lat), lon: Number(r.lon) })).filter((r) => isFinite(r.lat) && isFinite(r.lon)));
    },
    async weather() {
      const s = (await meta()).school;
      const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,weather_code,wind_speed_10m,wind_gusts_10m,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=Europe%2FTallinn&forecast_days=8&wind_speed_unit=ms`);
      const h = j.hourly || {}, d = j.daily || {}, c = j.current || {};
      return json({
        fetchedAt: new Date().toISOString(), loc: s,
        current: c.time ? { temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, wind: c.wind_speed_10m } : null,
        hourly: (h.time || []).map((t, i) => ({ t, temp: h.temperature_2m[i], feels: h.apparent_temperature[i], pop: h.precipitation_probability ? h.precipitation_probability[i] : 0, precip: h.precipitation[i], snow: h.snowfall ? h.snowfall[i] : 0, code: h.weather_code[i], wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m ? h.wind_gusts_10m[i] : h.wind_speed_10m[i], uv: h.uv_index ? h.uv_index[i] : 0 })),
        daily: (d.time || []).map((t, i) => ({ date: t, code: d.weather_code[i], tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], sunrise: d.sunrise[i], sunset: d.sunset[i] })),
      });
    },
    async route(u) {
      const lat = Number(u.searchParams.get('lat')), lon = Number(u.searchParams.get('lon')), toSchool = u.searchParams.get('dir') !== 'from';
      const date = u.searchParams.get('date') || '', time = (u.searchParams.get('time') || '').padStart(5, '0') + ':00';
      const school = (await meta()).school, home = { lat, lon }, a = toSchool ? home : school, b = toSchool ? school : home;
      const d = await otp(`{plan(from:{lat:${a.lat},lon:${a.lon}},to:{lat:${b.lat},lon:${b.lon}},date:"${date}",time:"${time}",arriveBy:${toSchool},numItineraries:6){itineraries{startTime endTime duration walkDistance legs{mode startTime endTime duration distance from{name} to{name} trip{tripHeadsign} route{shortName}}}}}`);
      const its = ((d.plan && d.plan.itineraries) || []).map(normItin).filter((i) => i.legs.length);
      its.sort(toSchool ? (x, y) => y.start - x.start : (x, y) => x.end - y.end);
      return json({ dir: toSchool ? 'to' : 'from', date, time: time.slice(0, 5), school, itineraries: its.slice(0, 5) });
    },
    async departures(u) {
      const stops = (await meta()).stops || []; if (!stops.length) return json({ stops: [] });
      const at = Number(u.searchParams.get('at')) || 0, st = at > 1e9 ? `,startTime:${Math.floor(at)}` : '';
      const d = await otp('{' + stops.map((s, i) => `s${i}:stop(id:${JSON.stringify(s.id)}){stoptimesWithoutPatterns(numberOfDepartures:8${st}){scheduledDeparture realtimeDeparture realtime serviceDay headsign trip{route{shortName mode}}}}`).join(' ') + '}');
      return json({ fetchedAt: new Date().toISOString(), stops: stops.map((s, i) => ({ ...s, deps: (((d['s' + i] || {}).stoptimesWithoutPatterns) || []).map((x) => ({ at: ((x.serviceDay || 0) + (x.realtimeDeparture ?? x.scheduledDeparture)) * 1000, sched: ((x.serviceDay || 0) + x.scheduledDeparture) * 1000, live: !!x.realtime, headsign: x.headsign || '', route: (x.trip && x.trip.route && x.trip.route.shortName) || '', mode: (x.trip && x.trip.route && x.trip.route.mode) || 'BUS' })) })) });
    },
  };
  window.fetch = async function (input, init) {
    const s = typeof input === 'string' ? input : input && input.url;
    if (typeof s === 'string' && s.startsWith('/api/')) {
      const u = new URL(s, 'https://x'), h = H[u.pathname.slice(5)];
      if (!h) return json({ error: 'not available on the static site' }, 404);
      try { return await h(u, init); } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
    }
    return realFetch(input, init);
  };
})();

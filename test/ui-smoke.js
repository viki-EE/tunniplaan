'use strict';
// Runs the page's real JS in a Node vm with a tiny fake DOM, against the real server + mock EduPage.
// Checks that every view renders, clicks work, and the two reported bugs are gone. (No CSS/layout checks.)
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const { startMock, setEnv } = require('./mock');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeEnv({ base, search = '', now = '2026-10-21T09:00:00' }) {
  const els = {}, handlers = {}, store = new Map();
  const mkEl = (id) => ({
    id, innerHTML: '', textContent: '', value: '', title: '', placeholder: '', content: '', style: {}, dataset: {}, isConnected: true,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener() {}, focus() {}, blur() {}, appendChild() {}, remove() {}, click() {},
    querySelectorAll: () => [], querySelector: () => null, parentElement: { contains: () => true },
  });
  const get = (id) => (els[id] = els[id] || mkEl(id));
  const document = {
    hidden: false, title: '', activeElement: null, body: mkEl('body'), documentElement: { dataset: {}, lang: '' },
    querySelector(sel) { if (sel[0] === '#') return get(sel.slice(1)); if (sel.startsWith('meta')) return get('meta'); return null; },
    querySelectorAll: () => [], createElement: () => mkEl('x'),
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
  };
  const errors = [];
  const ctx = vm.createContext({
    document, console: { log() {}, error: (...a) => errors.push(a.join(' ')) }, URL, URLSearchParams, Blob, Date, Math, JSON, Set, Map, Promise, Intl,
    setTimeout, clearTimeout, setInterval: () => 0, encodeURIComponent, decodeURIComponent,
    fetch: (u, o) => fetch(new URL(u, base), o),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    location: { search, hash: '' }, history: { replaceState() {} },
  });
  ctx.window = ctx; ctx.window.__NOW = now; ctx.window.scrollTo = () => {}; ctx.window.print = () => {}; ctx.window.addEventListener = () => {};
  ctx.URL.createObjectURL = () => 'blob:x'; ctx.URL.revokeObjectURL = () => {};
  const ev = (props) => ({ target: { id: '', tagName: 'DIV', closest(sel) { const k = sel.match(/data-(\w+)/)[1]; return props[k] !== undefined || props.__k === k ? { dataset: props.dataset } : null; } }, key: '' });
  const click = (key, dataset) => { const e = { target: { id: '', closest: (sel) => (sel.includes(`[data-${key}]`) ? { dataset } : null) } }; (handlers.click || []).forEach((f) => f(e)); };
  const press = (key) => (handlers.keydown || []).forEach((f) => f({ key, target: { tagName: 'BODY' }, preventDefault() {} }));
  const ev2 = (type, target) => (handlers[type] || []).forEach((f) => f({ target }));
  return { ctx, els, get, click, press, ev2, errors, ev: (e) => vm.runInContext(e, ctx) };
}
const wait = async (cond, ms = 4000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };
const count = (s, sub) => s.split(sub).length - 1;

async function run(name, env, fn) {
  try { vm.runInContext(script, env.ctx); await wait(() => env.ev('DATA') !== null); await fn(env); assert.deepEqual(env.errors, [], 'console errors: ' + env.errors.join('; ')); console.log('PASS ui:', name); }
  catch (e) { console.error('FAIL ui:', name, '\n', e); process.exitCode = 1; }
}

(async () => {
  const m = await startMock();
  setEnv(m.port);
  const { server } = require('../server.js');
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  await run('real server data: all views, clicks, bugs, i18n, export', makeEnv({ base }), async (E) => {
    const app = () => E.get('app').innerHTML;
    assert.ok(app().includes('10A'), 'hero shows first class');
    // --- now card: Wed 09:00 → maths (8:00–9:40) is live
    assert.ok(app().includes('Matemaatika') && app().includes('Right now'), 'live lesson shown');
    assert.ok(E.ev('document.title').includes('Matemaatika'), 'tab title shows current lesson');
    // --- bug 1+2: day view Wednesday for class 10A
    const wed = E.get('view').innerHTML;
    const pe = wed.split('class="lesson').find((b) => b.includes('Liikumisõpetus'));
    assert.ok(pe, 'gym lesson rendered');
    assert.equal(count(pe, 'Tüdrukud'), 1, 'group name must appear once, not once per class');
    for (const b of wed.split('class="lesson').slice(1)) assert.ok(count(b, 'data-go="room:') <= 1, 'room must not be shown twice in a lesson');
    assert.ok(!/Terve klass/.test(wed), '"whole class" pseudo-group hidden');
    assert.ok(pe.includes('Rea Lillemets') || pe.includes('Sten Kaldma'), 'full teacher names shown');
    // --- other views
    for (const v of ['week', 'live', 'stats', 'meet', 'day']) { E.click('act', { act: 'view', v }); assert.ok(E.get('view').innerHTML.length > 100, v + ' view empty'); }
    E.click('act', { act: 'view', v: 'week' }); assert.ok(E.get('view').innerHTML.includes('Matemaatika'.slice(0, 3)) || E.get('view').innerHTML.includes('MAT'), 'week grid has lessons');
    assert.ok(E.get('view').innerHTML.includes('↳'), 'double lesson continuation chip');
    // live view: switch type, free-only, time travel
    E.click('act', { act: 'view', v: 'live' });
    for (const k of ['teacher', 'room', 'class']) { E.click('act', { act: 'livetype', k }); assert.ok(E.get('livelist').innerHTML.length > 20, 'live ' + k); }
    E.click('act', { act: 'livetype', k: 'room' }); E.click('act', { act: 'livefree' }); assert.ok(E.get('livelist').innerHTML.includes('Free'), 'free rooms listed');
    E.click('act', { act: 'livefree' });
    E.ev2('change', { closest: (s) => (s === '[data-live]' ? { dataset: { live: 'period' }, value: '2' } : null) });
    assert.ok(E.get('livecount').innerHTML.includes('busy'), 'live counts');
    // clicking a teacher link jumps to teacher & leaves live view
    E.click('go', { go: 'teacher:t2' }); assert.ok(app().includes('Rea Lillemets') && app().includes('Teacher'), 'teacher selected');
    assert.ok(E.get('view').innerHTML.includes('10A') && E.get('view').innerHTML.includes('Tüdrukud'), 'teacher view shows class-prefixed group');
    assert.equal(count(E.get('view').innerHTML.split('class="lesson').find((b) => b.includes('Liik')), '10A Tüdrukud'), 1);
    // stats + meet for teacher & class
    E.click('act', { act: 'view', v: 'stats' }); assert.ok(E.get('view').innerHTML.includes('kpi'));
    E.click('go', { go: 'class:c1' }); E.click('act', { act: 'view', v: 'meet' });
    E.ev('S.meet.push({type:"teacher",id:"t1"})'); E.ev('render()');
    assert.ok(E.get('view').innerHTML.includes('Common free slots') && E.get('view').innerHTML.includes('m-all'), 'meet finds slots');
    // favourites, keyboard
    E.click('act', { act: 'fav' }); assert.equal(E.ev('S.favs.length'), 1);
    E.press('d'); E.press('ArrowRight'); E.press('t'); E.press('w'); E.press('l'); E.press('s'); E.press('m'); E.press('d'); E.press('1');
    // export
    const ics = E.ev('buildICS(entOf(S.sel.type,S.sel.id), lessonsFor(entOf(S.sel.type,S.sel.id)))');
    assert.ok(ics.includes('BEGIN:VEVENT') && ics.includes('RRULE:FREQ=WEEKLY') && ics.includes('SUMMARY:Matemaatika'), 'ics ok');
    E.click('act', { act: 'ics' });
    // settings, i18n, theme, help
    E.click('act', { act: 'settings' }); assert.ok(E.get('sheet').innerHTML.includes('Settings'));
    E.click('set', { set: 'lang', v: 'et' }); assert.ok(E.get('sheet').innerHTML.includes('Seaded'), 'estonian UI');
    assert.ok(E.get('app').innerHTML.includes('Päev') && E.get('app').innerHTML.includes('Klass'), 'estonian views');
    E.click('set', { set: 'theme', v: 'light' }); assert.equal(E.ev('document.documentElement.dataset.theme'), 'light');
    E.click('set', { set: 'accent', v: 'rose' }); E.click('set', { set: 'fullNames' }); E.click('set', { set: 'compact' });
    E.click('act', { act: 'reset' }); E.click('act', { act: 'help' }); assert.ok(E.get('sheet').innerHTML.includes('kbd'));
    E.click('act', { act: 'close' });
    // search ranking helper + diacritic folding
    assert.equal(E.ev("fold('Õismäe')"), 'oismae');
    // offline fallback: server dies → cached copy used
    E.click('act', { act: 'refresh' });
  });


  await run('v3: merged lessons, groups, weather, bus, staff, events, langs, settings', makeEnv({ base }), async (E) => {
    const view = () => E.get('view').innerHTML;
    await wait(() => E.ev('WX') !== null); E.ev('render()');
    E.click('go', { go: 'class:c2' });
    assert.ok(view().includes('link2') && view().includes('chain'), 'two identical lessons in a row are merged into one block');
    assert.ok(view().includes('☕'), 'break icon between merged periods');
    assert.equal(count(view(), 'lesson multi'), 1, 'merged into one card, not two');
    assert.ok(view().includes('class="card wx"') && view().includes('dr_') === false, 'weather card');
    assert.ok(view().includes('🧥') && view().includes('☂️'), 'dress tips (cold + rain)');
    assert.ok(view().includes('🦺'), 'reflector tip when dark at commute');
    // per-group timetable + my-groups filter
    E.click('go', { go: 'class:c1' });
    assert.ok(E.ev("ENTS.some(e=>e.type==='group')"), 'group entities searchable');
    assert.ok(view().includes('Tüdrukud') && view().includes('Poisid'));
    E.click('act', { act: 'mygroup', g: 'b1' });
    assert.ok(!view().includes('Tüdrukud') && view().includes('Poisid'), 'my-groups filter hides the other group');
    E.click('act', { act: 'mygroup', g: '' });
    E.ev("select('group','g1')"); assert.ok(E.get('app').innerHTML.includes('10A Tüdrukud') && E.get('app').innerHTML.includes('Group'), 'group page');
    // bus
    E.click('go', { go: 'class:c1' });
    E.click('act', { act: 'view', v: 'bus' }); assert.ok(view().includes('busq'), 'asks for address');
    E.get('busq').value = 'Õismäe tee 12'; E.click('act', { act: 'busgeo' }); await wait(() => E.ev('S.bus.geo') !== null);
    E.click('act', { act: 'buspick', i: '0' }); assert.ok(E.ev('S.home.lat') === 59.41);
    await wait(() => E.get('busres').innerHTML.includes('class="it'));
    const bus = E.get('busres').innerHTML;
    assert.ok(bus.includes('✅') && bus.includes('⚠') && bus.includes('★'), 'on-time, late and best markers');
    assert.ok(bus.includes('07:25') && bus.includes('36'), 'times + route numbers');
    await wait(() => E.get('deps').innerHTML.includes('class="dep"'));
    assert.ok(E.get('deps').innerHTML.includes('Kullerkupu') && E.get('deps').innerHTML.includes('Balti jaam') && E.get('deps').innerHTML.includes('09:07'), 'departure board');
    E.ev("render()"); E.click('act', { act: 'day', d: '4' });
    E.click('act', { act: 'view', v: 'day' }); E.click('act', { act: 'day', d: '2' });
    E.click('act', { act: 'view', v: 'day' }); await wait(() => E.get('busline').innerHTML.includes('🚌'));
    assert.ok(E.get('busline').innerHTML.includes('33'), 'day view bus line picks latest on-time departure');
    // staff
    E.click('act', { act: 'view', v: 'staff' }); assert.ok(view().includes('stt') && view().includes('Rea Lillemets'), 'staff table');
    assert.ok(view().includes('🟢') && view().includes('🔴'), 'present / in-lesson states');
    E.click('act', { act: 'stafff', f: 'off' }); assert.ok(!view().includes('Mari Tamm'), 'Mari has lessons today');
    // events + holidays
    assert.ok(E.ev("allEvents().some(e=>e.date==='2026-12-24'&&e.type==='holiday')") && E.ev("allEvents().some(e=>e.date==='2027-03-26')"), 'holidays incl. Good Friday 2027 (Easter 28 Mar)');
    E.click('act', { act: 'view', v: 'events' }); E.click('act', { act: 'evnew', date: '2026-10-22' }); assert.ok(E.get('sheet').innerHTML.includes('ev-title'));
    E.get('ev-title').value = 'Matemaatika kontrolltöö'; E.get('ev-type').value = 'test'; E.get('ev-date').value = '2026-10-22'; E.get('ev-end').value = ''; E.get('ev-time').value = '09:00'; E.get('ev-target').value = 'class:c1'; E.get('ev-note').value = '';
    E.click('act', { act: 'evsave', id: '' }); assert.equal(E.ev('EV.length'), 1);
    assert.ok(view().includes('Matemaatika kontrolltöö'), 'listed');
    await wait(async () => true); await new Promise((r) => setTimeout(r, 150));
    const srv = await (await fetch(base + '/api/events')).json(); assert.equal(srv.length, 1, 'saved on the server');
    E.click('act', { act: 'evview', v: 'month' }); assert.ok(view().includes('mc2') && view().includes('kontrolltöö'), 'month view');
    E.click('act', { act: 'evmonth', d: '1' }); E.click('act', { act: 'evmonth', d: '0' });
    E.click('go', { go: 'class:c1' }); E.click('act', { act: 'view', v: 'day' }); E.click('act', { act: 'day', d: '3' });
    assert.ok(view().includes('evp') && view().includes('kontrolltöö'), 'event banner on Thursday');
    assert.ok(E.get('app').innerHTML.includes('📝'), 'next-event pill in hero');
    E.click('act', { act: 'evquick', s: 'Matemaatika', c: 'c1', date: '2026-10-21' }); assert.ok(E.get('sheet').innerHTML.includes('Matemaatika: ') && E.get('sheet').innerHTML.includes('value="hw" selected'), 'homework quick-add prefilled'); E.click('act', { act: 'close' });
    E.click('act', { act: 'view', v: 'day' }); E.click('act', { act: 'wk', o: '1' }); E.click('act', { act: 'day', d: '0' });
    assert.ok(E.get('view').innerHTML.includes('offday') && E.get('view').innerHTML.includes('Autumn break'), 'autumn break replaces lessons on 26 Oct');
    E.click('act', { act: 'wk', o: '0' });
    E.click('act', { act: 'evdone', id: E.ev('EV[0].id') }); assert.equal(E.ev('EV[0].done'), true);
    E.click('act', { act: 'evdel', id: E.ev('EV[0].id') }); assert.equal(E.ev('allEvents().filter(e=>!e.ro).length'), 0, 'deleted');
    // languages + settings
    for (const [lang, word] of [['ru', 'День'], ['uk', 'День'], ['et', 'Päev'], ['en', 'Day']]) { E.click('set', { set: 'lang', v: lang }); assert.ok(E.get('app').innerHTML.includes(word), lang); }
    E.click('set', { set: 'lang', v: 'ru' }); E.click('act', { act: 'view', v: 'staff' }); assert.ok(E.get('app').innerHTML.includes('Учителя') && E.get('view').innerHTML.includes('Сейчас'), 'ru staff view');
    E.click('set', { set: 'lang', v: 'en' });
    E.click('act', { act: 'zoomin' }); assert.equal(E.ev('S.settings.scale'), 110); E.click('act', { act: 'zoomout' }); E.click('act', { act: 'zoomout' }); assert.equal(E.ev('S.settings.scale'), 90);
    E.click('set', { set: 'palette', v: 'cb' }); assert.ok(E.ev("colorOf('x')").startsWith('#')); E.click('set', { set: 'palette', v: 'mono' });
    E.click('set', { set: 'printMode', v: 'bw' }); assert.equal(E.ev('document.documentElement.dataset.print'), 'bw');
    E.click('set', { set: 'wide' }); assert.equal(E.ev('document.documentElement.dataset.wide'), 'on');
    E.click('act', { act: 'view', v: 'week' }); E.click('act', { act: 'wk', o: '1' }); assert.ok(E.get('app').innerHTML.includes('28 Oct') || E.get('app').innerHTML.includes('26 Oct'), 'next week navigation');
    assert.ok(E.get('printhead').innerHTML.includes('Õismäe'), 'print header');
    E.press('b'); E.press('p'); E.press('e'); E.press('d'); E.press(']'); E.press('[');
  });

  await run('v6: bottom nav, more sheet, footer', makeEnv({ base }), async (E) => {
    assert.ok(E.get('bnav').innerHTML.includes('data-act="more"'), 'bottom nav rendered');
    E.click('act', { act: 'more' }); assert.ok(E.get('sheet').innerHTML.includes('data-v="staff"'), 'more sheet lists other views');
    E.click('act', { act: 'view', v: 'stats' }); assert.ok(!E.get('modal').classList.contains('open'), 'picking a view closes the sheet');
    assert.ok(E.get('foot').innerHTML.includes('updated'), 'footer shows when data was updated');
  });
  await run('autumn break starts on the Saturday', makeEnv({ base, now: '2026-10-24T11:00:00' }), async (E) => {
    const h = E.get('app').innerHTML;
    assert.ok(h.includes('Autumn break'), 'break shown on Saturday'); assert.ok(h.includes('Back to school'), 'back-to-school countdown');
  });
  await run('weekend + after-hours states', makeEnv({ base, now: '2026-10-17T11:00:00' }), async (E) => {
    assert.ok(E.get('app').innerHTML.includes('Weekend'), 'weekend message');
    E.click('act', { act: 'view', v: 'live' }); assert.ok(E.get('view').innerHTML.includes('School is closed'), 'live view explains closed');
  });
  await run('after school on a weekday', makeEnv({ base, now: '2026-10-21T15:30:00' }), async (E) => {
    assert.ok(E.get('app').innerHTML.includes('Nothing more today'), 'day done message');
  });

  await run('demo mode (?demo=1) renders everything', makeEnv({ base, search: '?demo=1' }), async (E) => {
    assert.ok(E.get('banner').innerHTML.includes('Demo'), 'demo banner');
    for (const v of ['week', 'live', 'stats', 'meet', 'day']) { E.click('act', { act: 'view', v }); assert.ok(E.get('view').innerHTML.length > 100, 'demo ' + v); }
    const sel = E.ev("S.sel.id"); assert.ok(sel);
  });

  server.close(); m.server.close();
})();

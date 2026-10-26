'use strict';
const fs = require('fs');
const BASE = 'https://oismae.edupage.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const OUT = 'probe-out'; fs.mkdirSync(OUT, { recursive: true });
let cookie = '';
const save = (n, s) => fs.writeFileSync(`${OUT}/${n}`, typeof s === 'string' ? s : JSON.stringify(s, null, 1));
async function get(path) {
  try { return await get0(path); } catch (e) { console.log('::warning::GET ' + path + ' failed: ' + (e.cause ? e.cause.code || e.cause.message : '') + ' ' + e.message); return { status: -1, text: String(e.message) + ' ' + String(e.cause && (e.cause.code || e.cause.message)) }; }
}
async function post(path, body) {
  try { return await post0(path, body); } catch (e) { console.log('::warning::POST ' + path + ' failed: ' + (e.cause ? e.cause.code || e.cause.message : '') + ' ' + e.message); return { status: -1, text: String(e.message) + ' ' + String(e.cause && (e.cause.code || e.cause.message)) }; }
}
async function get0(path) {
  const r = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept-Language': 'et,en;q=0.8', ...(cookie ? { Cookie: cookie } : {}) } });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie = [...new Set([...cookie.split('; ').filter(Boolean), ...sc.map((c) => c.split(';')[0])])].join('; ');
  return { status: r.status, text: await r.text() };
}
async function post0(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'User-Agent': UA, Accept: 'application/json, text/javascript, */*; q=0.01', Origin: BASE, Referer: BASE + '/substitution/', 'X-Requested-With': 'XMLHttpRequest', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, text: await r.text() };
}
(async () => {
  const log = [];
  const sub = await get('/substitution/'); save('substitution-page.html', sub.text.slice(0, 400000)); log.push(['GET /substitution/', sub.status, sub.text.length]);
  const g = sub.text.match(/gsh["']?\s*[:=]\s*["']([0-9a-fA-F]{6,16})["']/); const gsh = g ? g[1] : '00000000'; log.push(['gsh', gsh]);
  for (const d of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-12', '2026-10-27', '2026-11-02']) {
    for (const mode of ['classes', 'teachers']) {
      for (const gg of [gsh, '00000000']) {
        const r = await post('/substitution/server/viewer.js?__func=getSubstViewerDayDataHtml', { __args: [null, { date: d, mode }], __gsh: gg });
        log.push(['subst', d, mode, gg, r.status, r.text.length, r.text.slice(0, 120)]);
        if (r.status === 200 && !/"reload"/.test(r.text.slice(0, 50))) { save(`subst-${d}-${mode}.json`, r.text); break; }
        await new Promise((x) => setTimeout(x, 400));
      }
    }
  }
  const tt = await get('/timetable/'); const g2 = tt.text.match(/gsh["']?\s*[:=]\s*["']([0-9a-fA-F]{6,16})["']/); const gsh2 = g2 ? g2[1] : gsh;
  for (const [tbl, id] of [['classes', '-133'], ['teachers', '-1']]) {
    for (const year of [2026, 2025]) {
      const r = await post('/timetable/server/currenttt.js?__func=curentttGetData', { __args: [null, { year, datefrom: '2026-10-19', dateto: '2026-10-23', table: tbl, id, showColors: true, showIgroupsInClasses: true, showOrig: true, log_module: 'CurrentTTView' }], __gsh: gsh2 });
      log.push(['currenttt', tbl, id, year, r.status, r.text.length, r.text.slice(0, 160)]);
      if (r.status === 200 && r.text.length > 300) { save(`currenttt-${tbl}${id}-${year}.json`, r.text); break; }
    }
  }
  const menu = await get('/menu/'); save('menu-page.html', menu.text.slice(0, 400000)); log.push(['GET /menu/', menu.status, menu.text.length]);
  const home = await get('/'); save('home.html', home.text.slice(0, 400000)); log.push(['GET /', home.status, home.text.length]);
  save('log.json', log); console.log('::notice::' + JSON.stringify(log.map((x) => x.slice(0, 6))).slice(0, 3000));
})().catch((e) => { console.log('::error::' + e.stack); save('fatal.txt', String(e.stack)); });

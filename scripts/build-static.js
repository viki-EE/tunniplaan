'use strict';
// Builds the GitHub Pages site into _site/: scrapes EduPage once, saves it as JSON next to the app.
// Run: node scripts/build-static.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, '_site');
process.env.DATA_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tt-'));
const { fetchFresh, getSchool, getNearStops } = require('../server.js');
// Public URL of the Pages site when built on GitHub Actions (owner.github.io/repo/).
const SITE = (() => { const r = process.env.GITHUB_REPOSITORY; if (!r) return ''; const [o, n] = r.split('/'); const ol = o.toLowerCase(); return n.toLowerCase() === `${ol}.github.io` ? `https://${ol}.github.io/` : `https://${ol}.github.io/${n}/`; })();
// GitHub Actions shows these as annotations on the run page.
const note = (lvl, title, msg) => console.log(process.env.GITHUB_ACTIONS ? `::${lvl} title=${title}::${String(msg).replace(/\r?\n/g, ' ')}` : `${title}: ${msg}`);

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

  let tt;
  try { tt = await fetchFresh(); note('notice', 'EduPage', `OK: ${tt.lessons.length} lessons, ${tt.classes.length} classes, ${tt.teachers.length} teachers (${(tt.timetable && tt.timetable.name) || '?'})`); }
  catch (e) {
    // Keep what the live site already has if possible (fresher than the seed), else the seed copy.
    let prev = null;
    if (SITE) { try { const r = await fetch(SITE + 'data/timetable.json', { signal: AbortSignal.timeout(15000) }); const j = r.ok ? await r.json() : null; if (j && Array.isArray(j.lessons) && j.lessons.length) prev = j; } catch (_) {} }
    note('warning', 'EduPage', `scrape failed (${e.message}); publishing ${prev ? 'the previous live copy' : 'seed/timetable.json'} instead`);
    tt = { ...(prev || JSON.parse(fs.readFileSync(path.join(ROOT, 'seed', 'timetable.json'), 'utf8'))), stale: true };
  }
  fs.writeFileSync(path.join(OUT, 'data', 'timetable.json'), JSON.stringify(tt));

  const meta = { builtAt: new Date().toISOString(), school: { lat: 59.4108, lon: 24.6528 }, stops: [] };
  try { const s = await getSchool(); meta.school = { lat: s.lat, lon: s.lon }; } catch (e) { note('warning', 'Geocode', e.message); }
  try { meta.stops = await getNearStops(); note(meta.stops.length ? 'notice' : 'warning', 'Bus stops', meta.stops.map((s) => s.name + ' ' + s.code).join(', ') || 'none found'); } catch (e) { note('warning', 'Bus stops', e.message); }
  fs.writeFileSync(path.join(OUT, 'data', 'meta.json'), JSON.stringify(meta));

  const ev = path.join(ROOT, 'events.json');
  fs.writeFileSync(path.join(OUT, 'data', 'events.json'), fs.existsSync(ev) ? fs.readFileSync(ev) : '[]');

  const idx = path.join(OUT, 'index.html');
  let html = fs.readFileSync(idx, 'utf8').replace('<script>', '<script src="static-api.js"></script>\n<script>');
  // Absolute URLs for link previews (Discord, WhatsApp, …) when built on GitHub Actions.
  if (SITE) html = html.replace('<meta property="og:image" content="og.png">', `<meta property="og:image" content="${SITE}og.png">\n<meta property="og:url" content="${SITE}">`);
  fs.writeFileSync(idx, html);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  console.log('built', OUT);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
// Builds the GitHub Pages site into _site/: scrapes EduPage once, saves it as JSON next to the app.
// Run: node scripts/build-static.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, '_site');
process.env.DATA_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tt-'));
const { fetchFresh, getSchool, getNearStops } = require('../server.js');

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

  let tt;
  try { tt = await fetchFresh(); console.log(`EduPage: ${tt.lessons.length} lessons, ${tt.classes.length} classes`); }
  catch (e) {
    console.warn('EduPage scrape failed, using seed/timetable.json:', e.message);
    tt = { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'seed', 'timetable.json'), 'utf8')), stale: true };
  }
  fs.writeFileSync(path.join(OUT, 'data', 'timetable.json'), JSON.stringify(tt));

  const meta = { builtAt: new Date().toISOString(), school: { lat: 59.4108, lon: 24.6528 }, stops: [] };
  try { const s = await getSchool(); meta.school = { lat: s.lat, lon: s.lon }; } catch (e) { console.warn('geocode failed:', e.message); }
  try { meta.stops = await getNearStops(); console.log('stops:', meta.stops.map((s) => s.name + ' ' + s.code).join(', ')); } catch (e) { console.warn('stops failed:', e.message); }
  fs.writeFileSync(path.join(OUT, 'data', 'meta.json'), JSON.stringify(meta));

  const ev = path.join(ROOT, 'events.json');
  fs.writeFileSync(path.join(OUT, 'data', 'events.json'), fs.existsSync(ev) ? fs.readFileSync(ev) : '[]');

  const idx = path.join(OUT, 'index.html');
  fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('<script>', '<script src="static-api.js"></script>\n<script>'));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  console.log('built', OUT);
})().catch((e) => { console.error(e); process.exit(1); });

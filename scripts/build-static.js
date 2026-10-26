'use strict';
// Builds the GitHub Pages site into _site/: scrapes EduPage once, saves it as JSON next to the app.
// Run: node scripts/build-static.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, '_site');
process.env.DATA_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tt-'));
const { fetchFresh, getSchool, getNearStops } = require('../server.js');
const { updateChanges, writeIcsFiles } = require('./extras.js');
// Public URL of the Pages site when built on GitHub Actions (owner.github.io/repo/).
const SITE = (() => { const r = process.env.GITHUB_REPOSITORY; if (!r) return ''; const [o, n] = r.split('/'); const ol = o.toLowerCase(); return n.toLowerCase() === `${ol}.github.io` ? `https://${ol}.github.io/` : `https://${ol}.github.io/${n}/`; })();
// GitHub Actions shows these as annotations on the run page.
const note = (lvl, title, msg) => console.log(process.env.GITHUB_ACTIONS ? `::${lvl} title=${title}::${String(msg).replace(/\r?\n/g, ' ')}` : `${title}: ${msg}`);

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

  // What the live site has right now: used to spot timetable changes, and as a fallback.
  const live = async (f) => { if (!SITE) return null; try { const r = await fetch(SITE + 'data/' + f, { signal: AbortSignal.timeout(15000) }); return r.ok ? await r.json() : null; } catch (_) { return null; } };
  const prevTT = await live('timetable.json'), prevChanges = (await live('changes.json')) || [];

  let tt;
  try {
    // EduPage occasionally drops a connection: try a few times before giving up.
    let lastErr;
    for (let i = 1; i <= 4 && !tt; i++) {
      try { tt = await fetchFresh(); } catch (e) { lastErr = e; console.log(`EduPage attempt ${i} failed: ${e.message}${e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : ''}`); if (i < 4) await new Promise((r) => setTimeout(r, 4000 * i)); }
    }
    if (!tt) throw lastErr;
    note('notice', 'EduPage', `OK: ${tt.lessons.length} lessons, ${tt.classes.length} classes, ${tt.teachers.length} teachers (${(tt.timetable && tt.timetable.name) || '?'})`);
  }
  catch (e) {
    // Keep what the live site already has if possible (fresher than the seed), else the seed copy.
    const prev = prevTT && Array.isArray(prevTT.lessons) && prevTT.lessons.length ? prevTT : null;
    note('warning', 'EduPage', `scrape failed (${e.message}${e.cause ? ', ' + (e.cause.code || e.cause.message) : ''}); publishing ${prev ? 'the previous live copy' : 'seed/timetable.json'} instead`);
    // The previous live copy keeps its own fetchedAt, so the page only warns once it is really old.
    tt = prev ? (({ stale, staleReason, ...rest }) => rest)(prev) : { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'seed', 'timetable.json'), 'utf8')), stale: true };
  }
  fs.writeFileSync(path.join(OUT, 'data', 'timetable.json'), JSON.stringify(tt));

  const ch = updateChanges(prevChanges, prevTT, tt);
  fs.writeFileSync(path.join(OUT, 'data', 'changes.json'), JSON.stringify(ch.list));
  if (ch.entry) note('notice', 'Timetable changed', ch.entry.big ? `new timetable (${ch.entry.count} differences)` : `+${ch.entry.added.length} / −${ch.entry.removed.length} lessons`);
  const ics = writeIcsFiles(tt, path.join(OUT, 'data', 'ics'), fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'));
  note('notice', 'Calendars', `${ics.files} .ics files (${ics.breaks} school breaks excluded)`);

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

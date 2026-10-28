# Tunniplaan — notes for Claude Code

Timetable site for Tallinna Õismäe Gümnaasium (scrapes the public EduPage timetable at oismae.edupage.org).
Live: https://viki-ee.github.io/tunniplaan/ · Repo: github.com/viki-EE/tunniplaan

## Layout
- `public/index.html` — the whole UI in one file (CSS + JS, no build step). i18n in `I18N` (en/et/ru/uk; Ukrainian is shown as "UA").
- `public/static-api.js` — on GitHub Pages it answers the page's `/api/*` calls in the browser.
- `server.js` — local Node server (no npm deps): EduPage scrape + normalize, weather, peatus.ee routes/departures, events.
- `scripts/build-static.js` + `scripts/extras.js` — Pages build (3×/day via `.github/workflows/pages.yml`): timetable JSON, change history (`data/changes.json`), `.ics` calendars.
- `android/` — plain-Java Android app (WebView of the live site + widget + lesson reminders). Built and released by `.github/workflows/android.yml` (APK on Releases).
- `test/` — `node test/api.test.js` and `node test/ui-smoke.js` (both must pass).

## Rules
- Commit as `viki-EE <viki-EE@users.noreply.github.com>` only. Never use any other name or email, and don't add Co-Authored-By lines (they show up as extra contributors).
- Keep replies short; the owner prefers brief answers.
- EduPage: periods can overlap (period 1 is listed 9:00–10:30); the code clamps them. Substitutions are not published by this school.
- Peatus.ee OTP wants times as HH:MM:SS.
- School breaks are hard-coded in `BREAKS` in index.html (scripts/extras.js reads them from there).

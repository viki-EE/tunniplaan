# Õismäe Gümnaasium · Tunniplaan

A fast, nicer viewer for https://oismae.edupage.org/timetable/

## Run
Needs Node 18+ (no npm install).

    node server.js

Then open http://localhost:3000

Env vars (optional): `SCHOOL=oismae`, `PORT=3000`, `YEAR=2026`, `HOST=0.0.0.0` (share on LAN), `SCHOOL_ADDRESS` or `SCHOOL_LAT`+`SCHOOL_LON` (bus/weather target), `DATA_DIR`.
`?demo=1` shows fake data. `/api/debug` shows what EduPage answered.

## Files
    server.js          scrapes EduPage, normalizes, caches (memory 10 min + cache.json for offline), serves the UI
    public/index.html  the whole UI (no build step)
    test/              node test/api.test.js · node test/ui-smoke.js

## Features
Day / Week / Live (whole school: busy & free classes, teachers, rooms, any day+period) / Stats / Meet (find common free slots).
Search classes, teachers, rooms, subjects · favourites · click any teacher/class/room to jump · calendar (.ics) export ·
print · EN/ET · dark/light/auto + accent colours · lesson reminders · works offline from the last saved copy.

## Also
Staff (who has lessons today / is off), Events (shared, saved in events.json, + Estonian public holidays), Bus (address → routes via peatus.ee), weather + dress tips, week navigation, my-groups filter, EN/ET/RU/UK, size slider, print colour modes.

## Keys
`/` search · `← →` day · `[ ]` week · `T` today · `D W L S M E B P` views · `+ −` size · `F` favourite · `1–9` favourites · `?` help

## New in v4
- **Phone access:** run `start-phone.bat` (instead of `start.bat`), then press 📱 in the app and scan the QR code. Phone must be on the same Wi-Fi; allow Node.js on *Private* networks if Windows asks. Anyone on that Wi-Fi can open it and edit events.
- **Focus mode** (⛶ or `K`): big clock with a countdown to the end of the lesson, plus the next lesson.
- **Bell schedule** (🔔): all lesson times and breaks.
- **Notes per subject** (✎ on a lesson), shown on every lesson of that subject.
- **Pack your bag** checklist under each day (subjects, notes, gym clothes, homework due).
- **First-run class picker**, **swipe** left/right to change day on phone, installable/offline (PWA) on the PC.

## Live website (GitHub Pages)
`.github/workflows/pages.yml` builds a static copy 3× a day: it scrapes EduPage (`scripts/build-static.js`) and publishes `public/` plus `data/*.json`. In the static site, weather, address search and buses are called straight from the browser; events are saved only on each device (commit an `events.json` to the repo root to publish school-wide events).
Setup once: repo **Settings → Pages → Source: GitHub Actions**, then **Actions → Deploy site → Run workflow**.

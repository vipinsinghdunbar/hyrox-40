# HYROX 40 v1 — local timer prototype

A clean, separate v1 workspace for the guide's static, offline-first iPhone PWA direction. The earlier account/server project is untouched.

## What's here

- `src/timer-engine.js` — pure timestamp-based session, segment, planned-rest and unplanned-rest state machine. No ticking counters are persisted.
- `src/storage.js` — local IndexedDB repository, per-action undo snapshots, JSON backup import/export, and a persistent-storage request.
- `src/app.js`, `src/app.css`, `index.html` — small timer-first interface; values entered on-device.
- `hyrox40-plan-config.json` — editable draft transcribed from the supplied guide. It is explicitly marked pending coach review. The training-week structure and progression fields follow the guide's placeholders; unknown station loads, rest rules and derived targets are left blank. No target-generation engine is enabled.
- `service-worker.js`, `manifest.webmanifest`, icons — install/offline shell assets.
- `tests/` — dependency-free Node tests for timer transitions and elapsed-time recovery.

No goals questionnaire is present. No third-party scripts, analytics, account, remote database, or app-generated external requests are included.

## Run tests

Requires Node.js 18 or newer:

```sh
npm test
```

## Preview locally

For development only, serve this folder on localhost (service workers and IndexedDB require a secure context such as localhost or HTTPS):

```sh
npm run serve
```

Open `http://localhost:8080`. Static-host this folder for deployment; there is no app backend. A Render static-site Blueprint is included in `render.yaml` (no build output or app server is required).

## Important limits before broader use

The plan config is a **draft**, not coach approval or medical advice. The guide says its training numbers are placeholders pending qualified review. In particular, no race-standard sled/wall-ball loads or custom station choice for the mini-simulation are inferred here. Attach the original `hyrox40-plan-config.json` from the planning chat, or have a coach approve the values before implementing plan-derived targets/progression.

Real-iPhone acceptance still required: install/add to Home Screen; screen-lock and wake-lock behavior; force-quit and resume; airplane-mode workout and save; export/import restore; safe-area and VoiceOver/tap-target review; verify IndexedDB persistence after OS eviction. The browser Wake Lock API can be unavailable or released by iOS, so it is not a guarantee against screen sleep.

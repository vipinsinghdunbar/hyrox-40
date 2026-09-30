# HYROX 40 v1 — local-first training prototype

This clean project is separate from the older account-enabled app. It follows the static, offline-first iPhone PWA direction: no backend, account, analytics, or external script. Workout data is stored in the browser's IndexedDB.

## Current local implementation

- Today and Plan views with a weekday baseline schedule, weekly focus, calendar status, and workout detail.
- Timestamp-based session/segment/rest timer, actual-value and sled-load entry, split summary/editing, undo and discard.
- Local workout history, basic run-pace/station summaries, dated body-weight log/trend, equipment profile, and local backup/restore including metadata.
- PWA manifest/service worker, safe-area/mobile CSS and black/yellow styling.
- Dependency-free Node tests for the timer engine and static mobile/config guardrails.

This is still a **prototype**, not the complete adaptive HYROX training product. It has not been visually verified in a browser at iPhone dimensions or tested on a real iPhone. Custom number wheels, polished calendar/history workflows, actual adaptive progression and full-screen accessibility review remain incomplete.

## Training-data safety

`hyrox40-plan-config.json` is a draft transcribed from the supplied guide and explicitly pending qualified-coach review. No sled loads or target-derived progression are invented or enabled. Obtain the original referenced config or coach approval before implementing adaptive prescriptions. No goals questionnaire, required benchmark, race-date field, or sled-weight onboarding is included.

## Run tests

Requires Node.js 18 or newer:

```sh
npm test
```

## Local preview

Serve over localhost (IndexedDB and service workers need localhost or HTTPS):

```sh
npm run serve
```

Then open `http://localhost:8080`.

## Render deployment

When v1 is correctly committed **inside** a `hyrox40-v1/` directory in the GitHub repo, create a separate Render Static Site to avoid changing the older Node service:

- Root Directory: `hyrox40-v1`
- Build Command: `echo "No build step"`
- Publish Directory: `.`

The root-level `render.yaml` in the older application must remain untouched. A repository being private does not make its deployed static URL private. Local workout data is not sent to Render.

## Still required before personal testing

Test the whole path on iPhone Safari and from the Home Screen: horizontal overflow at 320/375/390/430 CSS px; safe areas; screen-lock timing; force-quit resume; airplane-mode workout/save; export/import; VoiceOver and touch targets; IndexedDB persistence. Wake Lock may be unavailable or released by iOS and is not a guarantee against screen sleep.

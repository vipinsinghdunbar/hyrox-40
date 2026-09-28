# QA

## Checks the factory runs on every change
1. Lint.
2. Typecheck.
3. Unit tests.
4. Build.
5. Mobile end-to-end tests in Playwright.

If a check does not exist in this repo yet, it is listed under Known gaps in `ARCHITECTURE.md` and is not silently skipped.

Current status of each check in this repository:
1. Lint — MISSING (CI reports a warning: check skipped).
2. Typecheck — MISSING (CI reports a warning: check skipped).
3. Unit tests — `npm test` → `node qa_simulations.js` (exists; harness repaired in the factory-setup PR, see `DECISIONS.md`).
4. Build — `npm run build` → `node build.js` (exists).
5. Playwright mobile e2e — `npm run test:e2e` (added in the factory-setup PR; iPhone SE / iPhone 13 / iPhone 14 Pro Max projects, WebKit).

## Mobile viewports
1. iPhone SE, small screen.
2. iPhone 13, standard screen.
3. A large iPhone viewport (iPhone 14 Pro Max).

Playwright's WebKit approximates Safari but does not replace a real device. The Product Owner tests keyboard behaviour, safe areas and scrolling on a real iPhone before merge.

## Critical journeys
Taken from `PRODUCT.md`. Acceptance criteria are written as observable behaviours.

1. **Welcome screen loads** — Opening `/` shows the welcome screen: "HYROX" brand, "Your HYROX journey starts now." headline, sign-in action, no uncaught page errors, no horizontal scrolling at any of the three viewports. — COVERED BY TEST (Playwright smoke test, all three projects).
2. **Athlete setup completes** — With age, weight, height, experience, category and 2–3 goals chosen plus consent ticked, "Build my plan" leads to the Today dashboard and the values persist after reload. — COVERED BY TEST for validation logic and rendering (`qa_simulations.js`); NOT YET COVERED in a real browser.
3. **Weekly plan** — Plan page shows exactly five day rows with title, prescription and race-weight reference for the chosen division. — COVERED BY TEST (`qa_simulations.js`: 120 profile combinations × 5 days).
4. **Workout session** — Opening a day shows warm-up / main set / cool-down, the 40-minute timer, and per-movement controls; "Save workout" writes a log shown on Progress; targets adapt from a completed logged time but never from a partial one. — COVERED BY TEST (`qa_simulations.js`).
5. **Timer boundary** — The timer stops by itself at 40:00 and shows the completion message. — COVERED BY TEST (`qa_simulations.js`).
6. **Progress view** — Saved workouts appear with date, results and effort label; counts and chart update. — COVERED BY TEST for state and rendering (`qa_simulations.js`); NOT YET COVERED in a real browser.
7. **Passkey sign-in / account creation / email recovery** — Account actions reach the API, create a session, and recover access via a one-time emailed link. — NOT YET COVERED (blocked: `auth-client.js` missing from the repo, backend env not available in tests; see Known gaps in `ARCHITECTURE.md`).
8. **PWA install & update flow** — Install to home screen works; after a deploy the "Update ready" banner appears and Refresh loads the new build. — NOT YET COVERED by automation (build stamps the version — asserted in `qa_simulations.js`; service-worker behaviour needs a real device).

## Regression rule
Every bug fix adds a test that fails without the fix, where feasible.

## Not verified rule
Every PR lists what was verified and what was not. Anything unverified is a risk the Product Owner must see.

# PRODUCT

Product: HYROX 40 (repo `hyrox-40`; referred to as the "HYROX Journey" project in the setup request). In-app tagline: "Train with purpose".

## Vision
UNCONFIRMED — Product Owner to confirm.

## Target users
- One HYROX athlete training five 40-minute sessions per week with gym equipment (the UI references PureGym and race weights) — CONFIRMED FROM CODE (`manifest.json`, `index.html`, sidebar copy).
- The first deployment appears single-owner: the account screens are hard-coded to "Vipin · Admin + Athlete" and username `vipin` — CONFIRMED FROM CODE (`index.html` signup screen). Whether other athletes will ever get accounts: UNCONFIRMED — Product Owner to confirm.

## Core user journeys
Journeys that exist in the code today. Each is marked CONFIRMED FROM CODE (rendered/wired in the source) or UNCONFIRMED (cannot be verified end-to-end yet).

1. Welcome / entry screen with passkey actions — CONFIRMED FROM CODE.
2. Owner account creation via iPhone passkey + owner setup code — CONFIRMED FROM CODE (client and server code present; see gaps: `auth-client.js` is referenced but missing from the repo, and the API needs the deployed backend).
3. Passkey sign-in (Face ID / device PIN) — CONFIRMED FROM CODE (same caveat as #2).
4. Account recovery by verified recovery email — CONFIRMED FROM CODE (same caveat; also requires SMTP configuration).
5. One-time athlete setup: name, age, weight, height, experience, race category, 2–3 goals, consent — CONFIRMED FROM CODE (`setupPage`, validation in `validateProfile`, exercised by `qa_simulations.js`).
6. Today dashboard: weekly session count, today's plan card, quick stats — CONFIRMED FROM CODE (`todayPage`).
7. Weekly plan: five fixed training days with race-weight reference — CONFIRMED FROM CODE (`planPage`, `DAYS` in `index.html`).
8. Workout session: 40-minute timer, per-movement check-off, achieved-time/load entry, "how did it feel" feedback, save — CONFIRMED FROM CODE (`workoutHTML`, `saveWorkout`, covered by the VM harness).
9. Automatic target adaptation from logged results (and guard rails: partial results do not advance targets) — CONFIRMED FROM CODE (`qa_simulations.js` assertions).
10. Progress view: workout counts, body stats, recent history, weekly chart — CONFIRMED FROM CODE (`progressPage`).
11. Profile & measurement check-ins, text-size preference, sign out — CONFIRMED FROM CODE (`profilePage`).
12. PWA behaviour: install to home screen, offline cache via service worker, "Update ready" refresh banner — CONFIRMED FROM CODE (`manifest.json`, `sw.js`, `build.js` version stamping; real-device behaviour not verified by automation).

Onboarding = journey #5 (plus #2 for account creation). There is no separate workout-planning flow: the five-day plan is fixed in code.

## Product principles
1. Product before code: understand the problem before changing the implementation.
2. Mobile-first: iPhone behaviour is a first-class requirement.
3. Preserve existing functionality unless the request says otherwise.
4. Small, testable, reversible changes.

## Current priorities
UNCONFIRMED — Product Owner to confirm.

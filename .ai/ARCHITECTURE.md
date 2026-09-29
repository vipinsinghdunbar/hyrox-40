# ARCHITECTURE AND ENGINEERING RULES

## Stack
All items below are confirmed from the repository unless marked otherwise.

- **App**: single-page PWA in one file — plain HTML + CSS + JavaScript, no framework, no bundler. `index.html` (~300 lines) contains all markup, styles and logic.
- **Build**: dependency-free `node build.js` — copies the shell to `dist/` and stamps a content-hash version into `index.html` + `version.json`.
- **State**: browser `localStorage` (key `hyrox40`); optional sync to the account API when signed in.
- **Backend** (for the passkey account feature): Express server in `server.js` with `helmet`, `express-rate-limit`, `@simplewebauthn/server` (WebAuthn/passkeys), `pg` (PostgreSQL), `nodemailer` (recovery email). **These runtime dependencies are NOT declared anywhere in the repo** — there was no `package.json` before this PR. See Known gaps.
- **Database schema**: `sql/schema.sql` (PostgreSQL: `app_users`, `passkeys`, `account_state`).
- **Hosting**: Render Blueprint (`render.yaml`) — one static service (`hyrox-40`, auto-deploy off) and one Node service (`hyrox-40-secure`, Frankfurt, auto-deploy on, health check `/api/health`).
- **Package manager**: npm (chosen by this PR because `render.yaml` already calls `npm ci && npm run build` / `npm start`; the repo had no package manager before).

## Structure
```
index.html            The entire front-end app (markup, CSS, JS inline)
auth-client.js        MISSING — referenced by index.html but not present in the repo (see Known gaps)
sw.js                 Service worker: offline caching for navigation pages
manifest.json         PWA manifest ("HYROX 40 — Train with purpose")
icon.svg, icon.png    App icons
build.js              Dependency-free build → dist/ with content-hash version stamp
server.js             Express API: passkeys, sessions, account state, recovery
sql/schema.sql        PostgreSQL schema
qa_simulations.js     Dependency-free test harness (Node vm + assert) — the unit tests
render.yaml           Render deployment blueprint
GITHUB_SETUP.md       First-push and Render instructions for the Product Owner
HYROX_40_QA_Report.md Prior QA report (scenario matrix, fixed defects)
UI_UX_Motion_Review.md Prior UI/UX review
tests/e2e/            Playwright mobile smoke test + dependency-free dev server (added by this PR)
.ai/                  Product Factory operating system (added by this PR)
.github/              PR template + CI workflow (added by this PR)
```

## Data and integrations
- **Tables** (PostgreSQL): `app_users`, `passkeys`, `account_state` — see `sql/schema.sql`.
- **Local data**: `localStorage` key `hyrox40` (profile, logs, body checks, adjustments, session); key `hyrox40-text-size`.
- **API surface** (`server.js`): `/api/health`, `/api/status`, `/api/me`, `/api/passkey/register|auth` (options+verify), `/api/logout`, `/api/state` (GET/PUT), `/api/recovery/*` (email verify, request, passkey options/verify).
- **Environment variables** (names only): `PORT`, `NODE_ENV`, `APP_ORIGIN`, `RP_ID`, `DATABASE_URL`, `ADMIN_BOOTSTRAP_CODE`, `SMTP_URL`, `MAIL_FROM`.
- **No `.env.example` exists** — gap listed below; until one exists, this file is the reference for variable names.

## Commands
Exactly as available in this repository (added by this PR where marked).

| Purpose | Command | Status |
|---|---|---|
| Install | `npm ci` | added by this PR (no `package.json` existed before) |
| Dev server | `npm run dev` | added by this PR (none existed before — MISSING prior) |
| Lint | — | MISSING (no lint config or script exists) |
| Typecheck | — | MISSING (plain JS, no type checking configured) |
| Unit tests | `npm test` (runs `node qa_simulations.js`) | pre-existing |
| End-to-end | `npm run test:e2e` (runs `playwright test`) | added by this PR (MISSING prior) |
| Build | `npm run build` (runs `node build.js`) | pre-existing script name, new npm alias |
| Start (server) | `npm start` (runs `node server.js`) | script added by this PR; **cannot run** — runtime deps undeclared (Known gaps) |

## Conventions
Observed in the existing code — follow them:

- No frameworks, no build tooling beyond `build.js`; prefer dependency-free Node scripts (the repo's own tests and build are dependency-free; the dev server follows the same rule).
- One file owns the front end: styles inline in `<head>` `<style>` blocks, logic inline in one `<script>`; no external CSS/JS except `./auth-client.js`.
- Design tokens in `:root` custom properties; mobile-first with `@media(max-width:800px)` and `@media(max-width:390px)` breakpoints; dark mode via `prefers-color-scheme`; reduced motion via `prefers-reduced-motion`; contrast via `prefers-contrast`.
- Rendering: template-string HTML into `#app`, global `render()`; state object persisted with `persist()`; escape user data with `esc()`.
- Accessibility conventions: 44 px minimum touch targets (`button{min-height:44px}`, `.check` 44×44), `aria-label`/`aria-pressed`/`aria-current`, visible `:focus-visible` outlines, `env(safe-area-inset-*)` for notches.
- Copy conventions: no jargon ("RPE" deliberately banned — asserted in tests), plain-language effort labels, `en-DK` locale formatting.
- Naming: lowercase camelCase functions; pages named `*Page()`; tests as executable Node scripts.

## Engineering rules
1. Inspect before changing. Reuse existing patterns and components.
2. Feature branches named `factory/<short-slug>`. Never commit to `main`.
3. No new dependency without stated reason and Product Owner approval.
4. Keep changes small and reversible.
5. Update `.ai/` documents in the same PR when behaviour, structure or decisions change.
6. Secrets only through environment variables. Keep `.env.example` current (none exists yet — see Known gaps).

## Known gaps
1. **No lint and no typecheck** exist (CI reports them as skipped warnings rather than silently passing).
2. **`package.json` did not exist** before this PR although `render.yaml` runs `npm ci && npm run build` and `npm start` — the deploy contract and the repo disagreed. This PR adds a minimal `package.json` so those commands resolve; whether Render deploys currently succeed is UNCONFIRMED — Product Owner to confirm (Render dashboard is outside this repo).
3. **`server.js` runtime dependencies are undeclared** (`express`, `helmet`, `express-rate-limit`, `nodemailer`, `pg`, `@simplewebauthn/server`). Adding them requires Product Owner approval (new dependencies gate), so this PR does NOT add them. Consequence: `npm start` and the `hyrox-40-secure` Render service cannot build a working server until approved. UNCONFIRMED — Product Owner to confirm how this deployed before.
4. **`auth-client.js` is referenced by `index.html` (`<script src="./auth-client.js">`) but is missing from the repository** — every page load logs a 404 for it, and passkey/account features cannot work without it. UNCONFIRMED — Product Owner to confirm whether it was excluded from the project ZIP by mistake.
5. **No `.env.example`** documenting the environment variables (names are in this file instead).
6. **No browser tests existed** before this PR; `qa_simulations.js` runs the app in a Node VM (no real DOM, no real WebAuthn, no real service worker).
7. **The unit test harness was broken on `main`**: the welcome screen reads `window.location.protocol`, which the VM `window` stub did not provide → `npm test` failed before this PR. Fixed here with a one-line harness stub (test file only, no app code touched). Recorded in `DECISIONS.md`.
8. **No secrets scanning / dependency scanning** in CI.
9. **Playwright WebKit ≠ Safari on a real iPhone** — keyboard, safe areas and passkey UX still need the Product Owner's manual check (see `QA.md`).

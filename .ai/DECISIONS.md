# DECISIONS

Record decisions here so they are not re-debated. Format: date, decision, reason.

- 2026-09-28: GitHub is the source of truth. The chat is the interface, the repository is the memory. Reason: sessions do not remember each other.
- 2026-09-28: One session equals one request equals one branch equals one PR. Reason: Arena supports one PR per chat session.
- 2026-09-28: The factory never merges to `main` or deploys to production. The Product Owner merges after CI and preview review. Reason: controlled autonomy while trust is being built.
- 2026-09-28: Roles are checklists inside one orchestrator, not separate agents. Reason: simpler and cheaper until the pilot proves the need.
- 2026-09-28: CI is the objective gate for verification. Reason: the factory's own claims are not evidence.
- 2026-09-28: npm is this repository's package manager and Playwright (`@playwright/test`) is its only dev dependency. Reason: `render.yaml` already called `npm ci && npm run build` while the repo had no `package.json`; Playwright is required for the mobile smoke test. Runtime dependencies for `server.js` are still undeclared and remain gated on Product Owner approval.
- 2026-09-28: The dev/e2e server is a dependency-free Node script (`tests/e2e/serve.js`, `npm run dev`). Reason: keeps the repo dependency-free by design; serves the static shell for local dev and Playwright.
- 2026-09-28: The `qa_simulations.js` VM harness was stubbed with a minimal `window.location` so `npm test` passes on the current code. Reason: the passkey welcome screen reads `window.location.protocol`, which the harness did not stub — a pre-existing test-harness failure on `main`; fixed as a test-only change with no application code touched.

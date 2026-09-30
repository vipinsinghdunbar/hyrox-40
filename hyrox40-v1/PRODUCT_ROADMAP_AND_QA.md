# HYROX App — Product Roadmap & Acceptance Plan

This document records the user's master build brief and acceptance checklist for the **separate static v1 app**. The older account-enabled project must remain intact. Implement in order; do not skip ahead to progression logic while coach-reviewed inputs are missing.

## Current state (2026-09-29)

- The separate app exists locally at `/home/user/hyrox40-v1/`.
- Local IndexedDB/PWA prototype includes Today, Plan, History, Progress and Profile screens, calendar status, body-weight entries/trend, basic session/performance summaries, backup/restore and an executable baseline workout flow. Its dependency-free suite currently passes **16 tests** (12 timer-engine tests plus 4 static guardrail/config tests).
- Initial GitHub PR put files at repository root, then was reverted in PR #2. GitHub `main` is back to the older project. No corrected v1 branch/folder is in GitHub yet; do not overwrite root files.
- Render has no new v1 Static Site yet. Existing root `render.yaml` belongs to the older app; v1's `render.yaml` should remain under the v1 root. Deploy v1 as a **new Static Site** with root directory `hyrox40-v1`.
- Mobile-first black/yellow layout and safe-area/overflow guardrails are implemented locally. No browser-based viewport measurement, screenshot comparison, or real-iPhone test has been performed; CSS guardrail tests do not prove the UI has no overflow.
- `hyrox40-plan-config.json` is a draft from the supplied guide, not the separate coach-reviewed config referenced by it. Unknown loads/rests/derived targets are not to be invented.

## Build order and status

1. **Mobile/iPhone layout and no-overflow** — responsive shell, safe-area handling, wrapping, narrow-screen controls and reduced-motion styles are implemented. Browser viewport and real-device validation remain open.
2. **HYROX visual identity** — coherent black/yellow performance visual system is implemented in the prototype; review every future screen for consistency.
3. **Typography and content cleanup** — mobile wrapping and baseline copy are improved; full copy/accessibility review remains.
4. **Homepage redesign** — Today shows baseline focus, weekly activity, today's workout and primary action; replace static foundation copy with approved program state later.
5. **Plan redesign** — weekday and baseline session names, calendar strip and workout detail are implemented; multi-phase schedule/adaptive plan remains.
6. **Weekly focus** — baseline focus and explanatory rationale are shown without prescription shorthand; future phase focus depends on reviewed rules.
7. **Workout execution** — local baseline segments run in sequence with round labels, start/done/rest/undo/discard and split editing; broad strength-set editor remains.
8. **Timers** — timestamp-based session/segment/rest engine integrated with current workout view.
9. **Universal workout recording** — records segment distance/reps/time and optional actual sled load; strength set/rep/load model and full per-erg history remain.
10. **Calendar** — weekly planned/completed/missed/rest indicators and completion actions are implemented; full month/calendar navigation remains.
11. **History** — local completed-session list with summary details exists; richer edit/filter UX remains.
12. **Body-weight tracking** — dated entries, current value, simple trend chart, history list and user-selected next date are implemented; visual/device QA remains.
13. **Performance graphs** — basic body-weight and run-pace plots/station summaries exist; erg/sled/strength trend series and adherence graphs remain.
14. **Training progression** — intentionally disabled pending the original config, complete progression criteria and qualified coach review. Never invent loads or arbitrary progression.
15. **Profile redesign** — division/category/units/equipment settings exist; goal selection, mandatory benchmark, optional sled weight and race date are excluded.
16. **Safety UI** — concise expandable safety note is present; accessibility/content audit remains.
17. **Full UX audit** — not complete; verify visuals, navigation, timers, IndexedDB, backup round-trip, accessibility and malformed content.
18. **Full mobile journey test** — not complete; test on iPhone Safari/Home Screen and verify all criteria before personal testing.

## Training-system guardrails

- Product goal: a progressive HYROX performance journey, not a static list or generic workout generator.
- Training domains: running, SkiErg, rowing, sled push/pull, farmers carry, sandbag lunges, burpee broad jumps, wall balls, strength, conditioning and recovery.
- Candidate phase arc: Foundation → Strength Development → Running Development → HYROX Specificity → Race Preparation → Performance/Maintenance. Define purposes, metrics, workout types and transition criteria only after coach review and product decisions; no arbitrary phase lengths or loads.
- The supplied guide's plan numbers are placeholders pending qualified-coach sign-off. Obtain the missing `hyrox40-plan-config.json` or coach-approved replacement before activating target generation or adaptation.
- Preserve the no-goals-questionnaire correction. Do not add a goal picker.

## Personal-testing acceptance checklist

### Mobile and design
- [ ] No horizontal scrolling, clipping or off-screen controls at iPhone widths.
- [ ] Safe-area insets respected; portrait workout screens usable with tappable controls.
- [ ] Cards/text/navigation fit and remain legible; number entry/pickers work where applicable.
- [ ] Black/yellow system, typography, spacing, buttons and cards form one consistent product.

### Journey and data
- [ ] Homepage identifies phase, week, focus and today's workout.
- [ ] Plan uses weekdays and workout names; detailed movements appear after opening the workout.
- [ ] User can start/stop each interval/set, record results/load, save and find it in history.
- [ ] Calendar shows planned/completed/missed/rest and supports marking today's outcome.
- [ ] Dated body-weight entry persists and appears in history/trend; relevant performance trends are understandable.
- [ ] Close/reopen retains sessions and measurements; offline use works after first load.

### Real-device tests
- [ ] iPhone Safari and Home Screen install.
- [ ] Lock screen mid-segment and verify elapsed time.
- [ ] Force-quit and reopen mid-workout; correct timer/state is restored.
- [ ] Complete and save a workout in airplane mode after initial load.
- [ ] Export/import restores records.
- [ ] VoiceOver, focus, contrast, safe areas and touch targets checked.

## Definition of ready for personal testing

A person can open the app on iPhone, identify this week's focus and today's session, execute it, time/record all work, save, find the result in history/calendar, add body weight, see progress, close/reopen without losing data, and understand the next training step. Until that journey passes on a real device, do not call the product ready for personal testing.

# HYROX 40 — Simulation & QA Report

**Updated:** 28 September 2026  
**Build reviewed:** mobile-first HYROX 40 web/PWA in `index.html`  
**Status:** The three requested reproducible defects have been fixed and regression-tested in the Node VM harness. This is not a trainer-certified plan or a real-device usability sign-off.

## 1. What was tested

### Automated scenario matrix

- **120 profile combinations:** Women/Men × Open/Pro × three experience levels × all ten allowed two- or three-goal selections.
- **600 workout-screen renders:** five weekday workouts for each profile combination.
- Verified five-day plan rendering, division labels and race-weight references, warm-up/main/cool-down copy, and absence of `undefined`, `NaN`, broken object values, or visible “RPE” jargon.
- Checked run/erg targets, achieved-time controls, division/experience load conversion, and optional sled-tare-to-plate calculations.
- Checked onboarding markup, goal-count validation, workout save/history, and the 40-minute timer boundary.
- Added regression checks for slow benchmark scaling and target-time option availability; incomplete versus explicitly completed work; completion/distance persistence; and Sunday/weekend navigation after preview/save.
- JavaScript syntax check and `node qa_simulations.js` pass. Current output: **120 profile combinations × 5 workout screens = 600 workout render scenarios** plus onboarding, validation, target, load, save/history, timer, and the three regression suites.

The reproducible harness is **`qa_simulations.js`**. Run it from the app directory with `node qa_simulations.js`.

### Scope limit

This is a finite Node VM/mock-DOM simulation—not proof of all possible correctness. No real iPhone/Safari session, screen-reader pass, visual browser automation, offline-install test, or external human-trainer test was performed. No trainers or users have tested the app; the app is not represented as trainer-certified.

## 2. Requested bugs — fixed and verified

| ID | Prior issue | Change made | Regression verification |
|---|---|---|---|
| **BUG-01: Prescribed work could exceed the session/time picker** | A 15:00/km run benchmark, Beginner level, and run goal produced a 5 × 500 m Wednesday prescription at about 8:25 each / 42:05 total in a 28-minute main block; the achieved-time picker stopped at 40:00. | Run/SkiErg/row prescriptions now calculate their combined work time from the baseline/recent complete pace and goal-adjusted rep count, then scale the prescribed distances down in sensible increments when needed. The planned timed work uses a conservative 24-minute budget inside the 28-minute main block, with a station allowance on Friday. The achieved-time selector dynamically extends beyond the displayed target (with a 10-minute margin; maximum 2 hours). The plan and workout screen show the adjusted prescription. | Slowest tested baseline plus run goal: each timed day’s target plus the Friday station allowance remains within the 24-minute planned-work budget. For all three run/erg days, the achieved-time picker contains the generated target-total option. |
| **BUG-02: Partial work could update the next target** | A 5:00 entry without a completed-rep count was divided by all prescribed reps and could create an implausibly fast next target. | Target adaptation now uses only explicitly checked-complete movements. Each saved workout persists a per-exercise `completed` flag, rep/set count, and the distance represented by each timed interval. Incomplete/legacy records are not treated as completed pace results. Completed pace records older than 42 days are ignored for automatic target calculation. | A partial 5:00 entry with no completion check leaves the target unchanged; the saved record marks it incomplete and retains the per-rep distance. A separately checked-complete entry is accepted as the source for a subsequent target. |
| **BUG-03: Today could retain a previewed day or mislabel Monday on weekends** | Sunday defaulted to Monday but said “TODAY · MON”; saving a Friday preview could leave Friday displayed as Today. | The Today index is now derived from the calendar rather than preview selection. Saturday/Sunday label the Monday workout **“NEXT SESSION · MONDAY.”** Navigating to Today and saving a workout both clear the preview selection. | With the harness date fixed to Sunday, the label reads “NEXT SESSION · MONDAY”; after previewing and saving Friday, Today shows Monday’s plan, not Friday’s. |

The PWA service-worker cache was incremented to **`hyrox40-v6`** so updated assets can replace the earlier cached build.

## 3. Remaining issues and risks

| Priority | Issue | Recommended follow-up |
|---|---|---|
| **High — coaching/safety** | Sled and station training targets still use fixed experience multipliers (50%, 65%, 80% of race-standard loads). These multipliers are not validated by a HYROX coach, and sled friction/tare varies by gym. An incorrect tare can make plate recommendations misleading. | Obtain qualified coach review. Keep total-load and plate-load targets distinct, require verified sled tare before showing plate kilos, and include conservative calibration. Do not imply body weight alone determines a safe training load. |
| **High — recovery/programming** | Five sessions are arranged Monday–Friday, including station work Thursday followed by a mixed session Friday. There is no planned rest day inside the block, deload, or illness/fatigue adjustment. Goal selections can add a round. | Allow the five sessions to be spread across seven days, schedule recovery between demanding lower-body sessions, and add a reviewed deload/recovery rule. The timed-work budget fix does not validate overall weekly recovery. |
| **High — minors** | Age picker accepts 16–17, but those users receive the adult plan/load model. | Add an under-18 safeguard and coach/guardian guidance, or keep adult load recommendations unavailable for minors. |
| **Medium — target-time model** | Pace predictions still use simple benchmark/experience estimates, not coach-validated physiological zones. A completed session marked “Easy” can apply a 2% faster pace factor. | Label estimates clearly, use conservative progression caps and re-testing, and seek coach review. Automatic history use now requires an explicitly completed timed exercise and ignores records older than 42 days; entered profile benchmarks remain available until the athlete updates them. |
| **Medium — age/weight/height personalization** | Age, weight, and height are stored but do not materially change the training prescription. | Explain this distinction in the app. Personalize from useful performance and training history; do not derive “safe” working weight from body measurements alone. |
| **Medium — race date** | A race date can be saved, but it does not change the plan or create a taper. | Connect race date to a reviewed training block/taper or remove the implication that it personalizes current training. |
| **Medium — measurement progress** | Body measurements are stored as check-ins, but Progress has no weight-trend chart or change summary. | Add a dated weight trend and change-from-baseline view, plus deletion/export. |
| **Medium — data portability** | Workout and body history are stored only in browser local storage; clearing data or changing device/browser can erase it. | Add export/import (for example JSON/CSV) and explain backup/privacy. |
| **Medium — mobile interaction** | Tapping a movement check causes a full app re-render. This may shift scroll position or lose focus on iPhone; the mock-DOM tests cannot verify Safari behavior. | Preserve focus/scroll and verify on real iPhone Safari and Home Screen install. |
| **Low — readability/input bounds** | Weekly detail text is now larger (13 px desktop; 12 px mobile), but still needs review at narrow iPhone widths. Fixed profile picker ranges (age 16–90, weight 35–250 kg, height 130–220 cm) may exclude some people. | Conduct visual iPhone review; expand bounds or offer a safe out-of-range option. |

## 4. Test interpretation and next steps

1. **Profile/goal matrix — pass in mock-DOM simulation:** all tested category, experience, and goal combinations rendered; keep button-based setup and add real-browser selection tests.
2. **Weekly plan — pass in simulation:** all five sessions render. Prescribed timed distances now reflect the calculated time budget; visual layout still needs device review.
3. **Run/Ski/row timing — regression fix verified:** slow benchmarks are scaled, achieved-time wheels include their targets, and incomplete work cannot progress pace targets. The estimate model remains unvalidated by a coach.
4. **Weight/load conversion — functional, not coach-validated:** standards and experience-scaled targets render; sled tare-to-plate conversion is simulated.
5. **Save/progress — regression fix verified for completion and distance persistence:** existing local-only storage/backup limitations remain.
6. **Calendar/navigation — regression fix verified:** weekend next-session label and preview/save return path behave as expected in the Sunday simulation.
7. **iPhone/PWA/usability — not fully tested:** no actual iPhone, Safari, Home Screen, VoiceOver, external coach, or participant testing was done.

Recommended next work outside the three requested fixes: coach review of load and recovery logic; under-18 safeguards; data export/backup; and hands-on iPhone Safari testing.

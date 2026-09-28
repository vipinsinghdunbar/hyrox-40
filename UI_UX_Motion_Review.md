# HYROX 40 — UI/UX and motion review

## What is already working

- The app has a clear training identity: dark charcoal, lime performance accent, quiet violet, and a modular dashboard.
- A five-session week, 40-minute framing, and exercise-level result controls fit the product's iPhone-first purpose.
- Warm-up / main set / cool-down separate the session into understandable phases.
- The interface is self-contained and can render without remote fonts, scripts, or image services.

## Main friction points found in the current interface

1. **Workout progress was easy to lose.** The timer had no visual progress and movement checks did not summarize how much of a session was complete.
2. **The tap target for movement completion was only 22 px.** That is unnecessarily fiddly on a phone, especially mid-workout.
3. **Important exercise targets and directions were small.** In a gym, scanning an exercise target should take less effort than reading supporting notes.
4. **Every render replayed the same page entrance.** Since workout checks re-render the view, this made motion feel like a page reload instead of feedback tied to the action.
5. **A workout update can be easy to miss.** A phone-installed PWA needs a clear, low-friction update path when new code is deployed.

## Motion design applied

- **Navigation:** one short fade-and-rise when changing screens, not on every checkbox or control update.
- **Weekly plan:** small staggered arrivals to establish the five-day rhythm without delaying interaction.
- **Workout completion:** a restrained check pop, green card edge, and animated completion bar; the movement count updates with it.
- **Timer:** a lime elapsed-time rail and a gentle active-state accent make the 40-minute session legible at a glance.
- **Touch and keyboard:** subtle press feedback, no tap flash, and visible focus outlines. Completion controls are now 44 × 44 px.
- **PWA updates:** the app checks the deployed build when opened/foregrounded and every five minutes while active; it offers a refresh prompt rather than interrupting an active workout.
- **Accessibility:** all motion is CSS-only, brief, and disabled for `prefers-reduced-motion`. There is no looping motion in workout instructions or movement content.

## Motion principles to keep

- Motion should communicate state (where am I, how far through, did that action register?), never decorate every element.
- Keep routine transitions around 150–300 ms and screen entrances under 450 ms.
- Never block a tap while an animation runs; never auto-play video or exercise demonstrations.
- Preserve the reduce-motion path and verify animation/focus/scroll on a real iPhone before release.

## Release caveat

This is a source-and-simulation review, not a visual Safari/iPhone audit. The new states and timing have not been tested on a physical phone; check narrow-screen layout, Dynamic Type/zoom, VoiceOver, and reduced-motion behavior before treating the release as fully device-verified.

# Report: SHARLO-M1-007 — Capture feedback (beep/vibration) + reset loop

**Status: implementation complete, verified (unit tests + real browser), merged to `main` (PR #23, commit `47a7c0a`).**

---

## 🚩 Flags — read this section first

Nothing blocked. Two things worth flagging:

1. **This sandbox's `AudioContext` starts `'running'` immediately, with zero prior user gesture — real production browsers may not match this.** Measured directly (see "How this was tested"): a fresh `AudioContext` created in this environment's headless Chromium reports `state: 'running'` right away. Browsers commonly restrict audio autoplay until a user gesture unlocks it, and a real teacher's first visit to `/scan` may or may not have produced a gesture recent/specific enough to count, depending on the browser. `playCaptureBeep()` is written defensively regardless (feature-detected, wrapped in try/catch, never throws or blocks capture if audio doesn't actually play) — but whether the beep is _audible_ on a first real-world use, versus silently suspended until some later interaction, is not something this sandbox can settle. Flagged rather than assumed; physical-device testing (M1-008's iOS Safari pass, or general real-device QA) is where this actually gets resolved.
2. **The "reset loop" required no new code, and that's a deliberate finding, not a shortcut.** See "Key decisions" below for the reasoning — worth flagging up front so it doesn't read as an incomplete task. FR-SCAN-03's "camera view immediately resets" is satisfied by M1-004's already-existing `StabilityGate` re-arm behavior (verified back in that task's own report), not by anything added here.

---

## What was built

- **`apps/web/lib/scanning/capture-feedback.ts`**:
  - `playCaptureBeep()` — a short (150ms), 880Hz tone via the Web Audio API. Uses one `AudioContext` per page (module-level, lazily created, reused across calls) rather than constructing a fresh one per beep, which is both correct Web Audio usage and slightly more robust against autoplay-unlock state needing to be re-established every call.
  - `playCaptureVibration()` — a short (100ms) pulse via `navigator.vibrate`, feature-detected (`navigator.vibrate?.(100)`).
  - `playCaptureFeedback()` — calls both. Both individual functions, and the combined one, are wrapped in `try`/`catch` and never throw — feedback is explicitly non-critical-path: NFR-USE-03's manual "Take Photo" fallback already exists precisely because auto-capture-adjacent features aren't guaranteed on every device, and feedback failing must never interfere with the capture that already happened.
  - `resetCaptureFeedbackForTests()` — test-only hook to reset the module-level `AudioContext` cache between test cases, matching `opencv-loader.ts`'s own `resetOpenCvLoaderForTests()` convention.
- **`apps/web/app/(app)/scan/use-auto-capture.ts`** (updated) — `playCaptureFeedback()` is called directly inside the existing `onFrame` callback's `'captured'` branch (from M1-004), before the frame-grab logic, so it fires from the gate's own capture decision regardless of whether the (practically unreachable) frame-grab edge case succeeds.
- **Tests**: `capture-feedback.test.ts` — 8 tests covering both functions' happy paths (correct Web Audio node graph construction and `start`/`stop` calls; `navigator.vibrate` called with the right duration), the AudioContext-reuse behavior, and the "unavailable" and "throws" paths for both APIs, confirming neither ever propagates an error.

## Key decisions

### 1. No new "reset" mechanism — the existing one already satisfies FR-SCAN-03

The obvious-looking design for "resets for the next sheet" would be a UI-level timer: show the "Captured" badge for some fixed duration, then clear it and return to a neutral scanning view. That was deliberately _not_ built, for two reasons:

- **M1-004's `StabilityGate` already does this correctly.** Its `cooldown` state holds only until detection genuinely goes incomplete (the sheet is physically removed), at which point it returns to `searching` with zero artificial delay — verified in that task's own real-browser tests. A fixed UI timer would either (a) duplicate this with a second, independent notion of "ready," risking the two disagreeing, or (b) if it cleared the _visual_ indicator before the gate's own cooldown lifts, risk confusing a teacher into thinking the system is ready to capture a still-present sheet again when the gate would (correctly) still be refusing to.
- **NFR-PERF-01's "≤2s capture-to-ready" is dominated by human sheet-swapping speed, not software latency.** The interval from "capture fires" to "ready for the next sheet" is mostly however long it takes a teacher to physically move one sheet away and hold up the next — not something more engineering here would meaningfully change. What _is_ this task's job to establish is that the _system's own_ processing overhead is negligible against that 2-second budget, which is what was actually measured (see below), rather than inventing a fixed artificial delay to hit a number.

### 2. Feedback lives inside the existing `onFrame` callback, not a new effect

Same reasoning as M1-004's own design note, worth restating because it generalizes: any new "do something when capture happens" logic in this codebase should hook into the already-running RAF loop's callback rather than adding a second `useEffect` watching `autoCapture.status` as a dependency. The latter would mean a consumer's side effect running synchronously in an effect body on a value that (like `result` in M1-003, like the camera state in M1-002) is capable of changing many times a second — the same `react-hooks/set-state-in-effect`-adjacent shape already hit and fixed twice earlier in M1. Calling `playCaptureFeedback()` — a plain function call, not even a `setState` — directly inside the callback sidesteps the question entirely rather than needing a workaround for it.

## Deviations from the task description

None. The absence of a UI reset timer is a reasoned design decision (see above), not a descope.

## How this was tested

- **`npm run ci`** (format, lint, typecheck, test) — green at repo root. 89/89 tests passing in the `web` workspace (up from 81).
- **Real browser (Playwright, not jsdom)** — the actual `capture-feedback.ts` functions (bundled with `esbuild`, not reimplemented) against real `AudioContext`/`navigator.vibrate`:
  - `playCaptureBeep()` and `playCaptureVibration()`, called 5 times each, never threw.
  - `feedbackCallMs` — wall-clock time for a `playCaptureFeedback()` call to _return_ (not for the tone/vibration to finish playing, which the RAF loop never waits on) — measured at **33.5ms** on the first call. Comfortably under the 2000ms `NFR-PERF-01` budget, and this is the _worst-case_ (cold-start `AudioContext` construction) figure; subsequent calls reuse the context and should be cheaper still.
  - `AudioContext` state immediately after construction: `'running'` in this environment (see Flag 1 for what this does and doesn't establish).
- **Not done, explicitly**: confirming the beep is actually _audible_/the vibration actually _felt_ on a real device, or that a real production browser's autoplay policy behaves the same as this sandbox's headless Chromium — same limitation class as every prior M1 task's flagged hardware gap.

## Current status

Done. Merged to `main` via PR #23 (merge commit `47a7c0a`), head commit `70d9bee` verified green on both CI jobs before merging. Branch `claude/optimistic-allen-9ljry1` restarted from `main` post-merge and push verified landed (`git fetch` + SHA comparison).

Next: M1-008 (manual "Take Photo" fallback) — specifically called out in `TASKS.md` as needing iOS Safari testing, where auto-capture reliability (and, per Flag 1 above, possibly audio feedback) is expected to be weakest.

# Report: SHARLO-M1-004 — Stability gate & auto-capture trigger

**Status: implementation complete, verified (unit tests + real browser), merged to `main` (PR #17, commit `ba7aafe`).**

---

## 🚩 Flags — read this section first

Nothing blocked. Two things worth flagging, both the same category of limitation already established and accepted for prior M1 tasks:

1. **`DEFAULT_PIXEL_DELTA_TOLERANCE_PX` (6px) is a starting default, not a value tuned against real device/hand-tremor data.** It's calibrated against the ~1920px-wide feed `camera.ts` (M1-002) requests as its "ideal" resolution — a reasonable, documented assumption, same placeholder category as M1-003's ArUco-dictionary choice. Whoever does real-device testing (M1-008's iOS Safari pass, or general M1 hardening) should revisit this constant with actual data rather than assume it's final; it's exported and named specifically so it's easy to find and tune later.
2. **The "false-trigger rate measured... as a baseline metric" done-when criterion is satisfied with a synthetic pattern, not real hand-held-camera movement data.** What was actually measured: one specific alternating ±20px-per-frame jitter pattern, drawn synthetically and detected for real, in this sandboxed Chromium environment — 0 false triggers across 60 simulated frames. That's a genuine, real-detector-driven data point (not a mocked/assumed one), but it's one synthetic motion pattern, not a distribution of real trembling-hand or camera-shake data. Same root cause as every other "not verified on real hardware" flag in this project so far (no camera/device available in this sandbox). Worth being explicit that "measured" here means "measured against a synthetic proxy," not "measured in the field."

Also noting a scope interpretation, not a blocker: FR-SCAN-02's acceptance criteria says the false-trigger rate is "tracked as a quality metric during M1 testing" — read as an ongoing testing-and-reporting practice across M1 (record real numbers in each task's report, as this one does) rather than a mandate to build production telemetry infrastructure. There's no backend/account wiring anywhere in the codebase yet for this task to hook into, and building one now would be scope well beyond "stability gate & auto-capture trigger." Flagging the interpretation so it's a visible decision, not a silent assumption.

---

## What was built

- **`apps/web/lib/scanning/stability-gate.ts`** — framework-agnostic `StabilityGate` class (FR-SCAN-02). `update(result, now)` implements a small state machine:
  - `searching` — detection is incomplete (fewer than 4 corners); clears all internal state.
  - `stabilizing` — all 4 corners found; tracks `elapsedMs` since the _reference_ position (the position recorded when the current stable streak began, not the previous frame — see "Key decisions"). Resets to `elapsedMs: 0` with a new reference whenever any corner moves more than `pixelDeltaTolerancePx` from that reference.
  - `captured` — fires exactly once, when `elapsedMs` reaches `stabilityWindowMs` (default 500, per FR-SCAN-02), carrying the corners that were stable when it fired.
  - `cooldown` — holds after a capture, for as long as the same sheet remains in frame, so it doesn't fire again every subsequent frame; only clears back to `searching` once detection actually goes incomplete (the sheet is removed).
- **`apps/web/app/(app)/scan/use-corner-detection.ts`** (updated) — added an optional third parameter, `onFrame?: (result, now) => void`, invoked synchronously inside the loop's existing per-frame callback, immediately after `setResult`. See "Key decisions" for why this is additive to the loop rather than a second effect.
- **`apps/web/app/(app)/scan/use-auto-capture.ts`** (new) — `useAutoCapture(videoRef, config?)` owns a `StabilityGate` instance (constructed once via a lazy `useState` initializer) and returns `{ status, progress, capturedFrame, onFrame }`. Its `onFrame` is meant to be passed straight into `useCornerDetection`'s new parameter. On a `captured` transition, grabs the current video frame via an offscreen canvas (`drawImage` → `getImageData`) and exposes it as `capturedFrame: { imageData, corners, capturedAt }` — everything a downstream consumer (M1-005's perspective transform) will need.
- **`apps/web/app/(app)/scan/scan-client.tsx`** (updated) — wires `autoCapture.onFrame` into `useCornerDetection`, and adds a minimal visual proof of function: a "Hold steady… NN%" readout while `stabilizing`, and a "Captured" badge plus a small thumbnail (rendered from the real captured `ImageData`) once `captured`/`cooldown`. Acting on the captured frame is explicitly out of scope here — M1-005 onward.
- **Tests**: `stability-gate.test.ts` — 8 unit tests covering the full state machine (incomplete detection, first-frame start, capture after the full window, sub-tolerance jitter tolerated, over-tolerance movement resets the timer, continuous movement never captures, cooldown holds, re-arms after removal). `scan-client.test.tsx` — 4 new tests for the new UI states (stabilizing progress shown, captured indicator shown, indicator persists through cooldown, neither shown while searching), plus an existing test updated for `useCornerDetection`'s new third argument.

## Key decisions

### 1. Comparing against a fixed reference, not the previous frame

`StabilityGate` records the corner positions once, when a stable streak begins, and compares every subsequent frame against that same fixed reference rather than the immediately preceding frame. A frame-to-frame comparison would let slow, continuous drift pass as a sequence of individually-small "stable" steps even though the sheet moved substantially over the full 500ms window — comparing to a fixed reference for the whole window closes that gap and is a deliberately more conservative (safer, in line with this product's bias toward not capturing a bad frame) choice.

### 2. Feeding the gate from inside the existing detection loop, not a second effect

The natural-looking design — a hook that takes `useCornerDetection`'s `result` as a prop and reacts to it in its own `useEffect` — would call `setState` synchronously in that effect's body on every detected frame (~12×/second). That's the exact `react-hooks/set-state-in-effect` pattern already flagged and fixed twice in this project (`use-camera-stream.ts` in M1-002, `use-corner-detection.ts` itself in M1-003). Instead, `useCornerDetection` now accepts an optional `onFrame` callback invoked synchronously from inside its own already-running `requestAnimationFrame` loop — the same call shape as that loop's own `setResult`/`setMeasuredFps` calls, which are already known to be lint-clean. This also avoids running a second, fully redundant OpenCV detection loop (which a self-contained `useAutoCapture` with its own RAF loop would have required, doubling CPU/battery cost for no benefit).

### 3. Any incomplete frame fully resets the gate, even a single dropped one

At ~12fps, a single missed detection (e.g., one frame with minor motion blur mid-hold) costs at most one frame-interval (~83ms) of progress before the timer starts re-accumulating, not the whole 500ms — so the conservative choice (treat any incomplete frame as "not currently stable," full reset) has a small, bounded cost and keeps the logic simple. This errs toward the same "don't capture on a shakier signal" bias as decision 1, consistent with the product's broader NFR-ACC-03 philosophy of preferring to wait/flag over guessing, even though that NFR is specifically about bubble-answer confidence rather than capture timing.

### 4. Cooldown, not immediate re-arming

Without a cooldown state, a sheet held perfectly still after capture would re-trigger a "capture" on every single subsequent frame (each one still satisfies "stable for ≥500ms"). `awaitingRemoval` blocks that: once fired, the gate reports `cooldown` for every frame until detection genuinely goes incomplete (the teacher removes the sheet), matching FR-SCAN-03's flow ("camera view immediately resets for next sheet") even though the beep/vibration/reset UX itself is M1-007's job, not this task's.

## Deviations from the task description

None. The tolerance-constant placeholder (Flag 1) and the synthetic-vs-real false-trigger measurement (Flag 2) are limitations of what's verifiable in this environment, not scope changes.

## How this was tested

- **`npm run ci`** (format, lint, typecheck, test) — green at repo root. 47/47 tests passing in the `web` workspace (up from 35: +8 `stability-gate.test.ts`, +4 `scan-client.test.tsx`).
- **Real browser, real bundled code** — the actual `StabilityGate` and `CornerMarkerDetector` (bundled with `esbuild`, not reimplemented), loaded in a real Chromium page (Playwright) alongside real `opencv.js`, driven by real ArUco detections of a synthetically-generated sheet. Timestamps were injected (not wall-clock) so the ~500ms window could be tested without the script actually waiting — the gate's own design (time is a parameter to `update()`, not read internally) makes this straightforward and doesn't compromise what's being tested.
  - **Static-sheet scenario**: the same unmoved pixel data was re-detected repeatedly. Capture fired at the 8th simulated frame (~667ms simulated elapsed, ~583ms since the first stable detection) — within one frame-interval (~83ms, the ~12fps sampling rate) of the configured 500ms window, and never earlier. This also empirically confirms ArUco's own sub-pixel refinement doesn't introduce enough frame-to-frame numerical noise on identical input to spuriously exceed the 6px tolerance on its own — a question only a real detector run repeatedly could actually answer.
  - **Post-capture**: 5 further frames of the same still-held sheet all correctly reported `cooldown`, never re-capturing.
  - **Jitter scenario**: a sheet redrawn every frame with an alternating ±20px offset (well past the 6px tolerance) across 60 simulated frames (~5s simulated) never captured — 0 false triggers in this synthetic pattern (see Flag 2 for the honest scope of that claim).
- **Not done, explicitly**: any measurement against real hand-tremor/camera-shake movement data, or on physical mobile hardware — no camera/device available in this sandbox, same limitation class as every prior M1 task's flagged gap.

## Current status

Done. Merged to `main` via PR #17 (merge commit `ba7aafe`), head commit `66a2126` verified green on both CI jobs before merging. Branch `claude/optimistic-allen-9ljry1` restarted from `main` post-merge and push verified landed (`git fetch` + SHA comparison).

Next: M1-005 (perspective transform / dewarp) — the first task that acts on the frame this one now successfully captures.

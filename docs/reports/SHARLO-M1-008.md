# Report: SHARLO-M1-008 — Manual "Take Photo" fallback

**Status: implementation complete, verified (unit tests + real browser), merged to `main` (PR #25, commit `e6ed993`).**

---

## 🚩 Flags — read this section first

1. **This task's own done-when criterion cannot be satisfied in this environment, and that needs to be stated plainly rather than glossed over.** `TASKS.md` names it explicitly: "Specifically tested on iOS Safari, where auto-capture reliability is expected to be weakest." There is no iOS device, iOS simulator, or Safari engine available in this sandbox — Chromium is the only real browser here. This is the same root limitation already flagged for M1-002 (physical-device camera testing), M1-004 (real hand-tremor data), and M1-007 (real autoplay-policy behavior), but it is the most direct hit yet: those tasks' done-when criteria didn't _name_ a specific untestable platform, this one does. Nothing in this session substitutes for that test. What _was_ done: the button is built against well-documented iOS Safari constraints already established in this codebase (large tap target, no hover-dependent affordance, works within the existing `playsInline`/`muted`/`autoPlay` video setup from M1-002) and verified as thoroughly as this sandbox allows (see below) — but "verified thoroughly in Chromium" and "tested on iOS Safari" are different claims, and only the first one is true here.
2. **Two independent capture results (auto and manual) are intentionally kept separate in the UI, not merged into one "last capture" concept.** Flagging this as a considered design choice, not an oversight: see "Key decisions" below for the reasoning (mainly, that merging them risked showing a stale result from one path while the other's own state had moved on, and keeping them separate is more useful for verifying each path actually works independently).

---

## What was built

- **`apps/web/app/(app)/scan/capture-video-frame.ts`** (new) — the frame-grab logic previously inline inside `use-auto-capture.ts` (draw `<video>` to an offscreen canvas, read it back as `ImageData`) extracted into a standalone `captureVideoFrame(video, corners, now)` function, with the `CapturedFrame` type now owned here (re-exported from `use-auto-capture.ts` for backward compatibility with existing imports). Both the auto- and manual-capture paths call this same function now, so there's exactly one implementation, not two that could silently drift apart.
- **`apps/web/app/(app)/scan/use-manual-capture.ts`** (new) — `useManualCapture(videoRef, detectionResult)` returns `{ capturedFrame, canCapture, capture }`. `capture()` is a plain event-handler function (not tied to the corner-detection RAF loop at all) that calls `captureVideoFrame` directly against whatever the latest `detectionResult` is at the moment it's invoked — entirely bypassing `StabilityGate`. `canCapture` is `true` only when `detectionResult.complete` is `true`, for the caller to reflect in the button's `disabled` state.
- **`apps/web/app/(app)/scan/use-auto-capture.ts`** (updated) — refactored to call the extracted `captureVideoFrame` instead of its own inline copy; no behavior change.
- **`apps/web/app/(app)/scan/scan-client.tsx`** (updated) — a "Take Photo" button (bottom-center, large tap target), rendered unconditionally once `ready` regardless of `autoCapture.status` — the literal "always available" FR-SCAN-04 asks for. `disabled={!manualCapture.canCapture}` rather than hidden: the button never disappears, it just can't do anything meaningful without a complete detection (same requirement dewarp already has). A manual capture renders its own "Manual capture" + dewarped thumbnail pair, positioned separately (top-right) from auto-capture's own "Captured"/"Dewarped" pair (bottom-right).
- **Tests**: `capture-video-frame.test.ts` — 3 unit tests (returns `null` on an undecoded video, returns `null` when no 2D context is available, correctly draws and returns a `CapturedFrame` with a mocked canvas context). `scan-client.test.tsx` — 6 new tests: the button is always present regardless of auto-capture status, disabled when corners aren't detected, enabled and wired to `capture()` when they are, the current detection result is passed into the hook, and the manual-capture indicator shows/doesn't show independently of auto-capture's own indicator.

## Key decisions

### 1. The button is disabled, not hidden, when corners aren't detected

FR-SCAN-04 says "always available," which could be read as "always able to produce a capture no matter what." That reading isn't achievable without inventing a capture with no valid corner data, which the rest of the pipeline (M1-005's dewarp onward) has no way to use — there's no meaningful fallback without at least knowing where the sheet's corners are. The button itself is genuinely always rendered and visible the moment the camera is live, never conditionally hidden based on the auto-capture gate's internal phase (searching/stabilizing/cooldown) — which is the failure mode FR-SCAN-04 is actually guarding against (a fallback that vanishes exactly when you need it because some other subsystem's state says so). Disabling it when there's nothing valid to capture is a narrower, deliberate exception to that, not a contradiction of it.

### 2. Manual capture bypasses StabilityGate entirely, not just its timing

An earlier design considered feeding manual captures through some variant of the gate (e.g., forcing an immediate `'captured'` transition). Rejected: `StabilityGate` is stateful and owns its own cooldown/re-arm lifecycle for the _auto_ path — routing a manual, explicit user action through that same state machine would couple two things that should stay independent (a deliberate tap should never be blocked or altered by whatever the auto-gate happens to be doing, e.g., mid-cooldown from an auto-capture moments earlier). `useManualCapture` is entirely separate state, reading only the latest detection result as a plain value.

### 3. Auto and manual capture results are shown separately, not merged

A unified "last captured frame" (whichever of the two happened most recently) was considered and rejected: if auto-capture's own `capturedFrame` clears (back to `null` once the gate returns to `'searching'` after the sheet is removed) while an older manual capture is still sitting in `useManualCapture`'s state, a merged view would either keep showing the stale manual result with no way to tell it apart from a fresh one, or need extra bookkeeping to decide when to clear it — bookkeeping that risks reintroducing the kind of effect-reacting-to-a-changing-value pattern this codebase has deliberately avoided since M1-002. Two independent, clearly-labeled result areas are simpler and, for this stage of the pipeline (proof-of-function thumbnails, not final product UI), more useful: they make it possible to see that _each path_ is working on its own, not just that _some_ capture happened.

## Deviations from the task description

None beyond the iOS Safari testing gap (Flag 1), which is an environment limitation, not a scope change.

## How this was tested

- **`npm run ci`** (format, lint, typecheck, test) — green at repo root. 98/98 tests passing in the `web` workspace (up from 89).
- **Real browser, end-to-end, without physical camera hardware** — Playwright, this environment's Chromium. A synthetic sheet with 4 real ArUco markers was drawn to a canvas, then fed into a real `<video>` element via `canvas.captureStream()` — a genuine, standard browser API for producing a `MediaStream` from canvas content, giving the `<video>` element real decoded frame data to work with, the same way it would from an actual camera. Against that real video element:
  - The real `CornerMarkerDetector` (bundled, not reimplemented) completed detection (`complete: true`).
  - The real `captureVideoFrame` (bundled, not reimplemented) succeeded, returning an `ImageData` matching the video's real dimensions (1000×1300).
  - The captured frame's `corners` matched the detection result exactly (`JSON.stringify` equality) — confirming the manual-capture wiring correctly carries the detection result through, not a stale or default value.
- **Not done, explicitly, and this is the headline gap for this task**: testing on an actual iOS Safari browser/device. See Flag 1.

## Current status

Done, with the explicit exception noted in Flag 1. Merged to `main` via PR #25 (merge commit `e6ed993`), head commit `5a731fc` verified green on both CI jobs before merging (this run was noticeably slower than prior M1 task runs — confirmed via job step timestamps to be genuine, if slow, progress rather than a stuck run, not investigated further since it completed successfully). Branch `claude/optimistic-allen-9ljry1` restarted from `main` post-merge and push verified landed (`git fetch` + SHA comparison).

Next: M1-009 (roll-number grid reading) — the same bubble-reading technique from M1-006 applied to the roll-number block.

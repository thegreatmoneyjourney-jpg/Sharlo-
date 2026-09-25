# Report: SHARLO-M1-005 — Perspective transform (dewarp)

**Status: implementation complete, verified (unit tests + real browser, multi-angle), merged to `main` (PR #19, commit `22210cd`).**

---

## 🚩 Flags — read this section first

Nothing blocked. Two things worth flagging:

1. **A real bug was found and fixed during this task's own real-browser verification — worth reading in detail, not just noting it happened.** The first implementation mapped each corner marker's center exactly onto the output rectangle's edge pixels — e.g., the `topLeft` marker's center landed at output coordinate `(0, 0)`. Since a marker has real width, half of every marker's own footprint (whichever half extends toward the "outside" of the sheet) falls outside the `[0, width] × [0, height]` output canvas and gets clipped by `warpPerspective`'s implicit crop. Caught via the verification strategy below: re-detecting the same markers in the dewarped output failed at **every single tilt angle tested, including an untilted 0° control** — a strong signal the bug was in the transform's target geometry, not tilt-handling. Fixed by padding the output rectangle by a configurable ratio (default 6%, `DEFAULT_PADDING_RATIO` in `perspective-transform.ts`) on every side, so marker centers land inset from the edges rather than exactly on them. Re-verified clean afterward (see "How this was tested"). This is exactly the kind of bug M1-001/M1-002/M1-003's real-browser-verification discipline exists to catch before it ships — flagged here in full rather than only mentioned as "fixed along the way," per this project's standing practice of not glossing over a real defect once found.
2. **The 6% padding ratio is a placeholder default, not a confirmed value.** It determines how much margin exists between the marker-defined rectangle and the output's edges — which matters for whether a template's bubble grid (not yet defined; M2-001) could extend beyond the marker-to-marker span and get clipped. Until M2-001 defines real template geometry (specifically: how far the bubble grid extends relative to the 4 corner markers), 6% is a reasonable, round, exported/documented default rather than a validated number. Same placeholder category as M1-003's marker-ID choice and M1-004's pixel-tolerance constant.

---

## What was built

- **`apps/web/lib/scanning/perspective-transform.ts`** — `computeNormalizedSize(corners, paddingRatio?)` (pure, no OpenCV involved) computes the output rectangle's size from the observed marker span, padded by `paddingRatio` (default `DEFAULT_PADDING_RATIO = 0.06`) on every side. `dewarpFrame(cv, frame, corners, paddingRatio?)` builds the source (marker centers) and destination (padded rectangle corners) point `Mat`s in matching `topLeft, topRight, bottomRight, bottomLeft` order, computes the transform via `cv.getPerspectiveTransform`, and warps via `cv.warpPerspective`, cleaning up every intermediate `Mat` in a `finally` block — including the output `Mat` if `warpPerspective` itself throws, while leaving it un-deleted (caller-owned) on success.
- **`apps/web/app/(app)/scan/use-dewarp.ts`** — `useDewarp(capturedFrame)` runs the transform against the most recently auto-captured frame (M1-004's `CapturedFrame`) inside a plain `useEffect` keyed on `capturedFrame`, converting the input `ImageData` to a `Mat`, dewarping, and converting the result back to `ImageData` via `cv.imshow` onto an offscreen canvas.
- **`apps/web/app/(app)/scan/scan-client.tsx`** (updated) — wires `useDewarp` in and renders a small "Dewarped" thumbnail alongside the existing "Captured" one once a result is available, as the same category of visual proof-of-function established in M1-003/M1-004. Grid sampling/scoring against this rectified image is M1-006 onward.
- **Tests**: `perspective-transform.test.ts` — 10 unit tests: `computeNormalizedSize`'s span math (square, rectangle, larger-not-average edge selection) with `paddingRatio: 0` to isolate it from padding, plus dedicated padding-ratio tests (default and custom); `dewarpFrame`'s point construction/ordering, output-size/flags passed to `warpPerspective`, Mat cleanup (success and thrown-error paths), and the padded-destination-points behavior. `scan-client.test.tsx` — 3 new tests (passes `capturedFrame` into `useDewarp`, shows the dewarped preview once available, doesn't show it before one is available even while captured).

## Key decisions

### 1. Output size from the larger of each opposite edge pair, not an average

No template geometry exists yet to say what a sheet's true flat dimensions are (M2-001), so the output size has to come from what's actually observed: the marker positions in the (possibly tilted) captured frame. The edge of a tilted rectangle _closer_ to the camera measures _larger_ in pixels than the true flat length would foreshorten it to at a distance — so taking the **larger** of each opposite pair (top vs. bottom width, left vs. right height) approximates the true size better than averaging, which would systematically under-size the output whenever there's real tilt. This is the same heuristic used in well-known "four-point perspective transform" implementations elsewhere, not a novel invention.

### 2. Padding the destination rectangle (the bug fix, elevated to a documented design decision)

Beyond fixing the marker-clipping bug (Flag 1), padding is the right general shape for this function regardless: a captured frame's usable content (per FR-DETECT-01, ultimately a bubble grid) is very unlikely to be bounded _exactly_ by the 4 marker centers in every real template — markers are typically placed with some margin from the content they calibrate. Padding by a ratio (not a fixed pixel count) scales naturally with capture resolution/distance, unlike M1-004's pixel-based tolerance constant, which is deliberately resolution-specific for a different reason (comparing successive frames at a known target resolution, not sizing an output rectangle from scratch).

### 3. `useDewarp` reuses the plain-effect-on-a-discrete-value pattern, correctly this time

M1-002 through M1-004 each hit and fixed a version of `react-hooks/set-state-in-effect` — calling `setState` synchronously in an effect body reacting to a value that changes many times a second (camera stream resolution, ~12fps detection results). `useDewarp` is structurally different: `capturedFrame` only changes on a genuine new capture (at most a few times a minute in real use, driven by the stability gate, not a hot loop), so an effect keyed on it and calling `setPreview` from inside its `loadOpenCv().then()` callback is the same shape as every other _already-accepted_ async-effect pattern in this codebase (which is what actually matters to the lint rule — see `use-corner-detection.ts`'s own comment). The one part of this hook that _would_ repeat the antipattern — resetting `preview` synchronously when `capturedFrame` goes back to `null` — is avoided the same way `use-corner-detection.ts` avoids it: masked at the return statement (`capturedFrame ? preview : null`) instead of an effect-body `setState(null)`.

## Deviations from the task description

None beyond the padding-ratio placeholder already covered in the flags — no scope changes.

## How this was tested

- **`npm run ci`** (format, lint, typecheck, test) — green at repo root. 60/60 tests passing in the `web` workspace (up from 57).
- **Real browser, real bundled code, multi-angle** — the actual `dewarpFrame`/`computeNormalizedSize` and `CornerMarkerDetector` (bundled with `esbuild`, not reimplemented), in a real Chromium page (Playwright) with real `opencv.js`. Methodology, chosen specifically because this task's own done-when criterion names tilt angles up to 15° (unlike M1-003/M1-004, which didn't carry that specific bar):
  1. Draw a flat 1000×1300 synthetic sheet with 4 real ArUco markers (as in M1-003's verification).
  2. For each of 0°, 5°, 10°, 15°: warp the _whole sheet_ via `cv.warpPerspective` using a parametric trapezoid (top-edge marker centers squeezed toward the horizontal midpoint by `sin(angle) × 0.35 × width`, bottom edge unchanged) to produce a synthetic "tilted-looking" input. This is a documented approximation — a keystone whose severity scales monotonically and plausibly with angle, not a physically exact camera-projection model — chosen because it's cheap, reuses already-verified primitives, and only needs to be "a genuinely warped input a real dewarp should be able to correct," not a photorealistic render.
  3. Run the real `CornerMarkerDetector` on the tilted input — confirms detection itself tolerates this level of simulated tilt (a bonus finding beyond this task's own scope, complementing M1-003's only-tested-at-0° verification).
  4. Run the real `dewarpFrame` using the _detected_ (tilted) corner positions.
  5. Run the real `CornerMarkerDetector` again on the dewarped _output_ — if the transform is correct, the same 4 markers should be found again, close to the padded rectangle's 4 corners.
  6. Compare re-detected positions to the expected padded-corner positions (computed via the same `computeNormalizedSize` function the product uses, not a hand-rolled parallel formula, to keep the check honest about what it's actually verifying).
  - **First run (before the padding fix)**: output re-detection failed at all 4 angles — this is what surfaced the clipping bug in Flag 1.
  - **After the fix**: all 4 angles detected all 4 corners in the dewarped output, with positional error of **0 to 1.21px** across every corner and angle — comfortably sub-pixel-class accuracy across the full 0–15° range.
- **Not done, explicitly**: verification against a physically-accurate camera projection (the trapezoid is an approximation, not a lens/perspective-correct render) or on real device/hardware — same limitation class as every prior M1 task's flagged gap, no camera/device available in this sandbox.

## Current status

Done. Merged to `main` via PR #19 (merge commit `22210cd`), head commit `6eccd9e` verified green on both CI jobs before merging. Branch `claude/optimistic-allen-9ljry1` restarted from `main` post-merge and push verified landed (`git fetch` + SHA comparison).

Next: M1-006 (bubble grid sampling & fill-confidence scoring) — the task that actually reads answers from the rectified image this one now produces, and the direct enforcement point for NFR-ACC-03's "never guess" guarantee.

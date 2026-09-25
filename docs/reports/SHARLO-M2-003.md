# Report: SHARLO-M2-003 — Custom template creation from photo

**Status: implementation complete, verified end-to-end against a real running app (not just automated tests), PR open.**

---

## 🚩 Flags — read this section first

### 1. Persistence is deliberately deferred — no `owner_id` exists to save against yet

Saving a custom template needs a real authenticated user (`templates.owner_id`, per M2-002's schema), and M3 (accounts/auth/sessions) doesn't exist anywhere in this codebase yet. Rather than invent a fake auth mechanism or silently skip the "save" affordance, the UI's final step generates a real, correct, downloadable PDF (fully functional today) and shows a **visibly present but disabled** "Save to my templates" button with an explanatory tooltip ("Saving templates to your account is coming soon"). This mirrors how `scan-client.tsx` already operates ahead of Drive-sync's own M3 dependency — build the client-side flow fully, defer only the persistence call, and make the deferral visible rather than hidden. Whoever picks up M3 will need to wire a real save endpoint here; the geometry/PDF-generation side is already done and doesn't need to change.

### 2. Two real bugs were found and fixed during this task, not just designed around

- **`generate-pdf.ts`'s `OPTION_LETTERS` was hardcoded to exactly 4 entries** (`['A','B','C','D']`), a latent bug from M2-001 that only manifests once a template with a different option count exists — which this task is the first thing to actually produce. Any custom template with more or fewer than 4 options per question would have indexed past the array and printed `undefined` as a bubble's label, crashing (`pdf-lib` throws on a non-string `text`, confirmed by deliberately reverting the fix and reproducing the crash before restoring it — see "How tested"). Fixed by sizing the array to `MAX_CUSTOM_OPTIONS_PER_QUESTION` and regression-tested across the full 2–8 option range.
- **`detectSheetBoundary` reported a confident detection on a perfectly uniform (featureless) image.** Otsu's threshold still mechanically produces _some_ value on a unimodal histogram, which put the entire image on the foreground side; `findContours` then found one "contour" — the canvas's own outline — which passed every downstream check (large enough, resolves to exactly 4 points) and would have been confidently reported as "the sheet." Found by my own harness test failing, not by inspection. Fixed with a `cv.minMaxLoc`-based contrast pre-check (`MIN_CONTRAST_RANGE`), whose threshold value was chosen from real measurements (a uniform test image measured a 0-value range; a real sheet-vs-background photo measured 178), not guessed.

### 3. Algorithm choice for both new detection modules was decided empirically, and the "obvious" choice was wrong

Before writing `detect-sheet-boundary.ts`, three approaches were measured against synthetic photos with known ground-truth corners in a scratchpad probe (not committed — the production module's own doc comment carries the findings):

- **Canny edge detection + `findContours` + `approxPolyDP`** (the standard "document scanner" tutorial approach) — measured **broken under rotation**: edges from a non-axis-aligned rectangle have small gaps a 3×3 dilate doesn't reliably close, so `findContours` never saw one closed loop around the paper. The result was a small fragment reported as "the sheet," 28–55px off on a ~300px test image, while `approxPolyDP` still resolved it to a plausible-looking 4-point shape. This is exactly the kind of confidently-wrong result that would have passed a casual code review.
- **Otsu threshold + `findContours` + `minAreaRect`** — robust across rotation and noise (~1.2px error), but `minAreaRect` always fits a _rectangle_, so on a genuine perspective-distorted photo (foreshortened, not just rotated — the realistic case for a hand-held phone photo) it forced a rectangular fit onto a trapezoidal true shape: ~40px error.
- **Chosen: Otsu threshold + `findContours` + `approxPolyDP`**, combining Otsu's robustness with `approxPolyDP`'s shape-hugging — ~2.2px error on the same perspective-trapezoid case that broke `minAreaRect`. `minAreaRect` is kept only as a fallback for when `approxPolyDP` doesn't resolve to exactly 4 points.

Similarly, `detect-bubble-grid.ts`'s `HoughCircles` radius bounds were initially going to be a fixed pixel range (as most examples show), but production input has no a-priori known bubble size — a range derived as a fraction of the image's own dimensions was verified blind (no ground-truth radius given to the algorithm) across 4 synthetic grids spanning a >2.5x size range, with exact row/column recovery in every case.

### 4. This proves the pipeline composes correctly, not real-world accuracy against arbitrary photos

Same honest distinction M1-010's report drew for the whole M1 detection engine: the harness fixtures and the empirical algorithm-selection probes are synthetic (clean canvas-drawn rings/rectangles), not real photos of real teacher-made sheets, which will vary in bubble shape, ink color, paper texture, and lighting far more than any synthetic fixture does. `FR-TPL-02`'s acceptance criteria and `docs/ARCHITECTURE.md` §4 both anticipate this explicitly ("a fundamentally harder, less-constrained problem... we don't promise unattended accuracy there") — which is why every automatic estimate in this feature is paired with a mandatory review/adjust step, and why `detect-bubble-grid.ts` reports its own `confident` flag rather than ever presenting a shaky guess as solid. This feature was not in scope for `M1-011`'s real-device validation pass (that task covers the M1 scanning pipeline, not template creation) — if real-world custom-template-photo accuracy needs its own measurement pass later, that would be a new task, flagged here rather than assumed covered.

### 5. "Columns" in FR-TPL-02's "add/remove rows/columns" is read as options-per-question, not page layout

The SRS/TASKS wording doesn't disambiguate whether "columns" means the bubble options within a question (A/B/C/D...) or the page-layout column count (how many question-blocks sit side by side, as stock templates already vary by question count). This task reads it as **options-per-question** — the more product-relevant adjustment a teacher would actually want (some sheets use 5 options, A–E) — and leaves the page-layout column count as an automatic, teacher-invisible decision (`computeGridLayout`, capped at 25 rows per column, matching stock's own established reasoning). Flagging this as a judgment call rather than a silently-assumed reading.

### 6. Capture mechanism is file upload only, not a live-camera auto-capture loop

`docs/ARCHITECTURE.md` §4 says custom templates "reuse steps 1–4" of the scanning pipeline, which includes a per-frame stability gate — but that gate is built around ArUco marker detection running continuously at ≥10fps, and generic contour-based boundary detection (Otsu + `findContours` + `approxPolyDP`) has never been measured for per-frame real-time performance, only as a one-shot call. Building and verifying a new live-detection loop for a _different_ detection algorithm was a materially larger scope than this task's own description ("Auto-detect grid from an uploaded blank/sample sheet photo") calls for, and `FR-TPL-02`'s own requirement text says "upload a photo," not "take a photo." This task implements file upload as the (only) capture mechanism — a literal, defensible reading of the requirement, fully functional, and the safer scope given the per-frame performance question is unverified. A live-camera single-shot capture option (reusing `useCameraStream` + a manual "Take Photo" button, no auto-detect loop) would be a reasonable, low-risk future addition if the founder wants it, but wasn't required by the task's own wording.

---

## What was built

- **`lib/templates/detect-sheet-boundary.ts`** — `detectSheetBoundary(cv, image)`, returning ordered `{topLeft, topRight, bottomRight, bottomLeft}` corners or `null`. Includes the exported pure `orderQuadrilateralCorners` (sum/difference corner-ordering trick, unit-tested against upright, rotated, and trapezoid inputs) and the contrast/area guards described above.
- **`lib/templates/detect-bubble-grid.ts`** — `estimateBubbleGrid(cv, dewarpedImage)` → `{rows, columns, confident}`. `detectCircles` (OpenCV wrapper) and `clusterCirclesIntoGrid` (pure row/column clustering with a majority-consistency confidence gate) are separated so the clustering logic is directly unit-tested without a browser.
- **`lib/templates/geometry.ts`** — `computeGridLayout(questionCount)`, `computeCustomTemplateGeometry(questionCount, optionsPerQuestion)`, `TemplateLayoutTooDenseError`, and the `MIN/MAX_CUSTOM_QUESTION_COUNT`/`MIN/MAX_CUSTOM_OPTIONS_PER_QUESTION` bounds. `computeQuestions` was generalized to accept `layout`/`optionsPerQuestion` as parameters (stock's call site passes the exact same frozen values as before — zero behavior change there).
- **`lib/templates/generate-pdf.ts`** — the `OPTION_LETTERS` fix described above.
- **`app/(app)/templates/custom/`** (new route) — `page.tsx`, `custom-template-client.tsx` (step-based rendering), `use-custom-template-builder.ts` (the step state machine + OpenCV orchestration), `corner-adjust-overlay.tsx` (SVG drag-corners component, `viewBox`-scaled to natural image pixels so no manual display-scale math is needed for rendering), `image-loading.ts` (loads + downscales an uploaded file to a bounded resolution before detection/display).
- **Detection harness extension** (`tests/detection-harness/`): `template-creation-fixtures.ts` (synthetic sheet-photo and bubble-grid canvas builders, ported from the validating scratchpad probes) plus `runSheetBoundaryCase`/`runBubbleGridCase` in `browser-entry.ts` and 8 new Playwright cases in `detection-engine.pw-spec.ts`, run against the real shipped modules.
- **Tests**: `detect-sheet-boundary.test.ts` (5), `detect-bubble-grid.test.ts` (8), `generate-pdf.test.ts` (8, including the `OPTION_LETTERS` regression case), extended `geometry.test.ts` (+30), `custom-template-client.test.tsx` (11, jsdom-level with the OpenCV-touching hook mocked — see "How tested" for why the real logic is proven separately).

## Key decisions

Covered in the Flags section (algorithm choices, "columns" interpretation, capture mechanism, persistence deferral) — not repeated here.

One additional, smaller decision: uploaded photos are downscaled to a max 1600px dimension before any processing (`image-loading.ts`). A modern phone photo can be 3000–4000px on a side — far more than either detection module's parameters were verified against, and unnecessary for both detection quality and on-screen review. The displayed image and the pixels handed to detection are the same resolution deliberately, to avoid a coordinate-space mismatch between what the teacher drags and what geometry is actually computed against.

## Deviations from the task description

None against `docs/TASKS.md`'s own wording ("Auto-detect grid from an uploaded blank/sample sheet photo; present for manual review/adjustment... before save"), which this task implements literally. The capture-mechanism and "columns" judgment calls (Flags #5, #6) are readings of ambiguous wording, not deviations from anything the task explicitly specified.

## How this was tested

- **Unit tests** (pure logic, no browser): `orderQuadrilateralCorners`, `clusterCirclesIntoGrid`, `computeGridLayout`/`computeCustomTemplateGeometry` (including the density guard and validation bounds), `generate-pdf.ts` across the full option-count range. 194/194 web tests green (up from 132), 13/13 API tests green — the API suite was run against a real local Postgres (`service postgresql start`), not left to CI alone, matching M2-002's established practice.
- **Real-browser Playwright harness**: extended M1-010's harness with 8 new cases exercising the _actual shipped_ `detectSheetBoundary`/`estimateBubbleGrid` (not the throwaway probes) against straight, rotated, and genuine-perspective-trapezoid sheet fixtures and three grid sizes. 19/19 green, rebuilt and re-run clean immediately before pushing.
- **Real end-to-end verification against a running dev server** (`npm run dev` + Playwright driving a real Chromium, not jsdom): generated a realistic synthetic bubble-sheet photo (rotated sheet, 15×4 ring-bubble grid) and drove the actual page — upload → boundary detected and correctly outlined the rotated sheet (visually confirmed via screenshot) → dragged a corner handle and confirmed its rendered position actually moved → confirmed the grid step's pre-filled values _exactly_ matched the photo's true 15 questions × 4 options → generated and downloaded a real PDF via a `blob:` URL → confirmed the disabled "Save" button and its explanation are present. Separately verified the `TemplateLayoutTooDenseError` path: entering 500 questions × 8 options shows the inline error without losing the entered values or navigating away, and generating succeeds once corrected to reasonable values. Also confirmed no phrase in `['100% accura', 'fully automatic', 'guaranteed accura', 'perfectly detect']` appears anywhere on the page.
- **Deliberately reproduced both bugs before fixing them** (not just fixed on inspection): reverted the `OPTION_LETTERS` fix and confirmed the exact predicted crash (`TypeError: 'text' must be of type 'string'`) before restoring it; the contrast-guard fix was written directly from a failing harness test, then confirmed passing.
- A transient hydration-mismatch console warning (`caret-color: transparent` on the file input) appeared on the very first page load of the very first e2e run against a freshly-started dev server. Investigated rather than ignored: repeated across 4 subsequent clean loads (including 3 with the identical `waitUntil: 'load'` condition) with zero recurrences, consistent with a Turbopack first-compile/dev-warmup artifact (or Chromium's own autofill heuristics touching the input post-paint) rather than a defect in this component's actual markup — nothing in this component's code sets `caret-color` anywhere.
- `npm run ci` (format, lint, typecheck, test) green locally before pushing.

## Current status

Implementation done, pushed to `claude/optimistic-allen-9ljry1`, PR #35 open against `main`. Watching CI to green before merge, per the standing workflow.

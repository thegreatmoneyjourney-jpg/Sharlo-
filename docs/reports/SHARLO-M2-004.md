# Report: SHARLO-M2-004 — Answer-key scan flow

**Status: implementation complete, verified end-to-end against a real running app (not just automated tests), PR open.**

---

## 🚩 Flags — read this section first

### 1. A real, subtle bug was found and fixed — `dewarpedDestRect`'s padding formula

The core of this task is "the template geometry reader" — mapping a template's bubble positions (`geometry.ts`, fixed PDF-point coordinates relative to the 4 corner markers) onto real pixel positions in a dewarped camera frame. Both `bubble-fill.ts` and `roll-number.ts` (M1) explicitly deferred this exact piece of work to M2-004.

The mapping technique itself (a bubble's position expressed as a _fraction_ of the marker rectangle is identical in PDF-point space and dewarped-pixel space, since undoing scale/rotation/perspective variation is exactly `dewarpFrame`'s job) was already proven as a test-only helper in `tests/detection-harness/fixtures.ts`'s `expectedDewarpedPoint`. Promoting it into real production code surfaced a bug that helper's own narrower usage never exercised: `dewarpedDestRect()` computed the destination rectangle's padding as a fraction of the **padded** dewarped output size, but `dewarpFrame` itself (`lib/scanning/perspective-transform.ts`, unchanged M1-005 code) computes padding as a fraction of the **unpadded** marker span — `padY = Math.round(span.height * paddingRatio)`, not `dewarpedSize.height * paddingRatio`. The two differ by a factor of `(1 + 2 * paddingRatio)` — at the codebase's `DEFAULT_PADDING_RATIO` (0.06), about 12% over-padding.

This is a **scale-compression error, not a translation**: it pulls every mapped point toward the frame's horizontal/vertical center, with zero effect exactly at the center and growing linearly with distance from it. That's precisely why it was invisible on the existing M1-010 harness fixtures (few rows, positioned near the frame's own center) and only became visible on a dense, 20-row, real-stock-template-shaped layout — meaning this bug would very plausibly have shipped undetected without specifically building the new full-stock-sheet-read harness scenario this task added. On that real layout it was large enough to read multiple genuinely-empty bubbles as ambiguous.

Found empirically, not by inspection, via a disciplined isolation process (documented in full in `dewarpedDestRect`'s own doc comment for future maintainers):

1. Ruled out corner-detection noise as the cause — detected vs. theoretical marker positions agreed to within a uniform ~0.5px.
2. Ruled out warp pixel-content distortion — a straight line drawn into the source image stayed perfectly straight after a real detect→dewarp round trip.
3. First attempt at a position-error isolation test used a **vertical** reference line and found it perfectly stable — which turned out to be a flawed test design, not evidence of no bug: a vertical line exists at every Y, so it's structurally incapable of revealing a Y-axis position error (any row scanned, right or wrong, finds it at the same X). Caught this myself and redesigned the test.
4. A **horizontal** reference-line test at known Y positions correctly revealed the true signature: ~0px error at the frame's vertical center, growing to double-digit-pixel error by the last row — linear and sign-symmetric about the center, the exact fingerprint of a scale error.

Fixed by inverting `dewarpFrame`'s own formula (`span.height ≈ dewarpedSize.height / (1 + 2*paddingRatio)`), with a new unit test that independently reconstructs `dewarpFrame`'s exact formula and cross-checks agreement, plus the 3 new full-pipeline Playwright harness cases (0°, a real detected/dewarped 10° tilt, and a left-blank case) that exercise the actual shipped mapping/reading code against real rendered pixels, not mocks.

### 2. Two legitimate supporting fixes were needed alongside the real fix — neither alone was sufficient

While isolating the bug above, two other changes were made and kept because they're independently correct, not because they papered over the real issue:

- **`SAMPLE_RADIUS_RATIO = 0.75`** — the bubble-fill sampling radius must be strictly smaller than the _printed_ bubble radius, or the sample circle's edge sits on the printed ring's own ink. `tests/detection-harness/fixtures.ts` had already established this principle for its own synthetic bubbles (`SAMPLE_RADIUS_PX`'s doc comment); this module's first version failed to reuse it and sampled at the full printed radius, which alone was enough to make every bubble read back ambiguous regardless of the padding bug.
- **`STOCK_SHEET_RENDER_SCALE = 3`** in the new harness fixture — at the geometry's raw 1-PDF-point-per-pixel convention, a 20-question stock sheet's dewarped output is only ~492px wide, giving each bubble only a few pixels of sampling radius; ordinary sub-pixel corner-detection error is then disproportionately large relative to the bubble itself. Rendering at 3x makes the fixture representative of a real phone-camera capture's resolution (which is typically far higher than 492px across the answer area), not just large enough to dodge the failure — judged a legitimate accuracy improvement to the test fixture, not a workaround.

Applying both of these alone did not fully resolve the issue; the padding-formula fix (Flag 1) was the actual root cause. All three changes are needed together and are all independently justified — none is a hack to mask another.

### 3. Persistence is deliberately deferred — same pattern M2-003 already established

Exam setup, answer-key capture, and student-sheet scoring are all fully functional client-side this task — but nothing is saved. `docs/TASKS.md`'s M3 section (master key generation, local-only mode, encrypted envelope storage) is still entirely unbuilt, so there's no encryption/persistence layer to write results into yet, exactly the same dependency M2-003 flagged for custom-template saving. A teacher can run a full scan-key → scan-students → see-live-scores session today; closing the tab loses everything. This is not hidden — `new-exam-client.tsx`'s own doc comment states it directly, and nothing in the UI implies results are being saved.

### 4. The template picker offers stock templates only, not custom ones

M2-003's custom-template flow doesn't persist a template beyond its own page (Flag 3 of that report — no `owner_id` to save against). Since there is nothing durable to list, this task's exam-setup picker only offers the 3 stock templates. Stock templates are fully usable end to end today. Wiring a session-held (not-yet-persisted) custom template into this picker would be a reasonable, low-risk follow-up, not a silent gap — flagged here rather than assumed out of scope.

---

## What was built

- **`lib/templates/map-geometry-to-frame.ts`** — `mapTemplateGeometryToFrame(geometry, dewarpedSize, paddingRatio)`, the template geometry reader described above. Exports `dewarpedDestRect` (the destination-rectangle/padding logic, the site of the bug fix) and `SAMPLE_RADIUS_RATIO`.
- **`lib/scanning/read-answer-sheet.ts`** — `readAnswerSheet(imageData, mappedGeometry, thresholds?)`. Adds no new sampling/classification logic of its own; applies `bubble-fill.ts`'s existing `sampleBubbleFillRatio`/`classifyQuestion` to every question and roll-number column a mapped template defines.
- **`lib/scanning/score-answers.ts`** — `scoreQuestion`/`scoreSheet`. A student answer only ever scores `correct`/`incorrect` against a key entry that itself cleanly resolved to `answered`; any `flagged` student mark, or (defensively) an unresolved key entry, routes to `needs-review` rather than being guessed either way — the same "flag, don't guess" principle enforced at the scoring layer.
- **`app/(app)/exams/new/`** (new route) — `new-exam-client.tsx` (title + stock-template picker), `exam-scan-flow.tsx` (camera flow: captures and validates the answer key first, refusing an incompletely-marked key and naming exactly which question wasn't clear; then scores every subsequent capture against it live, showing score/roll-number/needs-review count), `use-sheet-reader.ts` (the dewarp → map → read pipeline as a hook, mirroring `use-dewarp.ts`'s capture-keyed-effect shape), `page.tsx`.
- **Detection harness extension**: `tests/detection-harness/stock-sheet-fixtures.ts` (renders a full real stock-template sheet — real ArUco markers plus real bubble rings/fills at `geometry.ts`'s actual computed positions, distinct from `fixtures.ts`'s simplified synthetic layout) and `runFullStockSheetReadCase` in `browser-entry.ts` (full detect → dewarp → map → read pipeline against real rendered pixels), with 3 new Playwright cases.
- **Tests**: `map-geometry-to-frame.test.ts` (8, including a formula cross-check against `dewarpFrame`'s own math), `read-answer-sheet.test.ts` (5), `score-answers.test.ts` (9), `new-exam-client.test.tsx` (5), `exam-scan-flow.test.tsx` (8).

## Key decisions

Covered in the Flags section (the padding-formula bug and its two supporting fixes, persistence deferral, stock-only template picker) — not repeated here.

## Deviations from the task description

None against `docs/TASKS.md`'s own wording ("Dedicated first-scan flow that sets the scoring reference for an exam... every subsequent student-sheet scan scores immediately against the captured key") — implemented literally, including the "immediately" (scoring runs as soon as a capture is processed, no separate submit step). The persistence and template-picker points above are scope boundaries inherited from already-flagged upstream dependencies, not deviations from this task's own description.

## How this was tested

- **Unit tests** (pure logic, no browser): `map-geometry-to-frame.ts`'s `dewarpedDestRect`/`mapTemplateGeometryToFrame` (including the identity case, proportional radius scaling, ordering/count preservation, in-bounds placement, purity, and the `dewarpFrame`-formula cross-check), `read-answer-sheet.ts`, `score-answers.ts` (including the length-mismatch guard and every outcome combination). `new-exam-client.test.tsx`/`exam-scan-flow.test.tsx` mock out every OpenCV/camera-touching hook (same rationale `scan-client.test.tsx` already established) to prove state transitions, validation, and score display in isolation. 229/229 web tests green. 13/13 API tests green, run against a real local Postgres (`service postgresql start`), matching M2-002/M2-003 precedent — this task touches no API/schema code, so this confirms no regression there.
- **Real-browser Playwright harness** (`npm run test:e2e`, real headless Chromium + OpenCV WASM, not jsdom): 22/22 green, including the 3 new full-stock-sheet-read cases run against the actual shipped `map-geometry-to-frame.ts`/`read-answer-sheet.ts` — 0° tilt, a real detected-and-dewarped 10° tilt, and a case with one left-blank question and one left-blank roll-number column, confirming both read correctly as `blank` rather than a guessed pick. This suite is what actually caught the padding bug (Flag 1) and proves the fix against real rendered pixels, not just algebra.
- **Real end-to-end verification against a running dev server** (`npm run dev` + Playwright driving real Chromium with `--use-fake-device-for-media-stream`, the same precedent `docs/reports/SHARLO-M1-002.md` established): setup form → entered a title, selected a template → camera-live scan screen with the correct "scan the answer key first" banner → confirmed "Take Photo" is correctly disabled (the fake device's generic test-pattern feed has no real ArUco markers, so `canCapture` correctly stays false) → "End exam" returns cleanly to the setup screen. This proves the UI/hook composition wires together correctly in a real browser; it does not exercise detection accuracy (no real markers in the fake feed), which is what the Playwright harness above proves instead.
- Confirmed no phrase in `['100% accura', 'fully automatic', 'guaranteed accura']` appears anywhere on the setup or scan screens (automated in both component test files).
- `npm run ci` (format, lint, typecheck, test) green locally before pushing, plus the detection harness suite run separately (it's a distinct CI job, not part of `npm run ci`).

## Current status

Done. Implementation pushed to `claude/optimistic-allen-9ljry1`, PR #36 opened against `main`, all CI checks (format/lint/typecheck/test, the Playwright detection harness, and the Docker image build) green on the implementation commit. This report and the `docs/TASKS.md` status update are pushed as a second commit onto the same PR; merging once CI is reconfirmed green on that new head, per the standing workflow.

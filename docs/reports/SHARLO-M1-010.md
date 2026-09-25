# Report: SHARLO-M1-010 — Detection engine test harness

**Status: implementation complete, verified (11 Playwright cases + full local `npm run ci`), merged to `main` (PR #29, merge commit `a7fbdbf`).**

---

## 🚩 Flags — read this section first

Three things worth flagging explicitly rather than leaving implicit — none blocking, but all judgment calls a future reader should see reasoned through, not just assumed.

### 1. "Sample sheet images" was built as checked-in generator code, not binary PNGs

TASKS.md's own wording for this task is "Reusable fixture-based test harness (**sample sheet images** with known ground truth)." I read "sample sheet images" as describing the _effect_ (fixtures that look like a real scanned sheet), not a literal requirement for binary image files, and built deterministic TypeScript generators (`tests/detection-harness/fixtures.ts`) that draw real ArUco markers and real bubbles onto a real `<canvas>` at test-run time instead. Reasons: every prior M1 task's real-browser verification (M1-003 through M1-006) already established and relied on exactly this technique; a generator keeps every fixture reviewable as a plain-text diff instead of an opaque binary; and it stays trivially parameterizable (new tilt angles, grid shapes, fill patterns are just new function arguments, not new binary assets to produce and check in). If "sample sheet images" specifically meant real scanned paper, that's a different, larger undertaking — real printers, real pens, a real camera, real lighting — which is exactly the category of still-open device-testing gap this session has already flagged repeatedly (M1-002, M1-004, M1-007, M1-008) and which section 3 below addresses directly.

### 2. Scope within "M1-003 through M1-009": the _detection engine_ proper, not every M1 task

The task title is "**Detection engine** unit test harness." Of M1-003–M1-009, four modules are genuinely detection-engine algorithms with a ground-truth-checkable correctness property — corner detection (M1-003), perspective dewarp (M1-005), bubble-fill sampling/classification (M1-006), and roll-number reading (M1-009) — and this harness exercises all four, end to end, composed exactly as the real pipeline composes them. The other three are capture-UX/trigger concerns, not detection algorithms, and I left them out deliberately rather than by oversight:

- **M1-004 (stability gate)** is pure timestamp/pixel-delta arithmetic with no canvas/WASM surface — already fully covered by `stability-gate.test.ts`, and per the same reasoning M1-009's own report already established for itself, there's no jsdom-vs-real-browser behavioral gap for code that touches no browser API, so a real-browser fixture case would prove nothing a unit test hasn't.
- **M1-007 (capture feedback)** calls the Web Audio/Vibration APIs — it has no "ground truth" output to assert (the question is "does it call the right browser API," not "is this numeric result correct"), and was already verified directly in a real browser at M1-007's own task time.
- **M1-008 (manual capture fallback)** is button-enabled-state UI logic, already covered by `scan-client.test.tsx`.

If this narrower reading of "detection engine" is wrong and the founder wants fixture coverage for those three too, that's a scope addition to flag back, not something I inferred silently.

### 3. What this fixture set can and can't establish against NFR-ACC-01–04's numeric targets

This is the most important thing to be honest about. NFR-ACC-01 (≥98% corner-detection success), NFR-ACC-02 (≥99.5% agreement on confident bubbles), NFR-ACC-03 (≤0.5% silent-misread rate), and NFR-ACC-04 (≤5% flag rate) are all **statistical targets against real-world conditions** — real camera sensors, real lighting variance, real paper/ink/printer imperfections, real hand tremor, real lens distortion. This harness's 11 cases, all currently passing, establish something real but narrower:

- **What it proves:** the pipeline's stages compose correctly end-to-end (a regression in, say, coordinate mapping or threshold logic will be caught), corner detection is geometrically sound across 0–15° of simulated tilt, and — the most valuable part — the NFR-ACC-03 "never silently guess" trust guarantee holds at the _integration_ level (real WASM, real rendered pixels) across several representative adversarial cases: a uniformly faint mark, multiple confident marks, and multiple simultaneously-ambiguous options. That last guarantee is a property of the code, not of statistics, so it doesn't need real-world data to be meaningful.
- **What it can't prove:** the actual ≥98%/≥99.5%/≤0.5%/≤5% numbers. A 100% pass rate on synthetic, noise-free, geometrically-clean fixtures is not evidence toward those targets and must not be read as such — there's no JPEG compression, motion blur, uneven lighting, paper curl, print misregistration, or lens distortion anywhere in this fixture set. The tilt simulation itself is the same documented keystone _approximation_ M1-005 already used and accepted, not a physically exact camera-projection model. Validating the real targets needs real device/camera testing, the same still-open gap already named for M1-002/M1-004/M1-007/M1-008.

---

## What was built

- **`apps/web/tests/detection-harness/fixtures.ts`** — deterministic, parameterized synthetic-sheet drawing: real ArUco markers via `cv.generateImageMarker` (reusing the exact technique verified in M1-003/M1-005), real ringed/filled bubbles via canvas 2D drawing, a whole-canvas perspective warp to simulate camera tilt (reusing M1-005's own keystone approximation), and `expectedDewarpedPoint`/`destRectFor` — the math that predicts where a flat-sheet point lands in the dewarped output, valid for _any_ tilt angle because dewarping a homography-warped image and re-applying the same homography-derived point mapping are provably the same transform (documented in full in that function's doc comment). This lets every test assert against a plain-arithmetic expected position with no OpenCV call on the "expected" side, keeping the check independent of the code under test.
- **`apps/web/tests/detection-harness/browser-entry.ts`** — the harness's exposed surface (`window.DetectionHarness`), composing `fixtures.ts` with the real product modules (`CornerMarkerDetector`, `dewarpFrame`, `sampleBubbleFillRatio`/`classifyQuestion`, `readRollNumber`/`matchRollNumber`) into three small, serializable-in/out entry points (`runCornerDetectionCase`, `runQuestionGridCase`, `runRollNumberCase`) that `page.evaluate()` calls can drive without ever passing a `cv`/`Mat` handle across the Node↔browser boundary.
- **`apps/web/tests/detection-harness/detection-engine.pw-spec.ts`** — 11 `@playwright/test` cases: corner detection at 0°/5°/10°/15° tilt (NFR-ACC-01); a correctly-answered question at two tilt angles and a blank question (NFR-ACC-02); three never-guess cases — uniformly faint partial fill, two confident marks, multiple simultaneously-ambiguous options — plus one proving an ambiguous question doesn't contaminate a neighboring confident one on the same sheet (NFR-ACC-03/FR-DETECT-03); and matched/unmatched/unreadable roll-number cases (FR-DETECT-04). Every expected outcome is written out literally in the test, never derived from the same numbers used to draw the fixture.
- **`apps/web/tests/detection-harness/harness.html`**, **`apps/web/scripts/build-detection-harness.mjs`** (esbuild-bundles `browser-entry.ts` + copies `opencv.js`, same pattern as `copy-opencv-asset.mjs`), **`apps/web/scripts/serve-detection-harness.mjs`** (dependency-free static file server for Playwright's `webServer`), **`apps/web/playwright.config.ts`**.
- **New CI job** (`detection-harness` in `.github/workflows/ci.yml`): installs Playwright's Chromium fresh (`npx playwright install --with-deps chromium`) and runs the suite headlessly. Runs in parallel with the existing `ci`/`docker-build` jobs, no shared dependency.
- **New devDependencies** in `apps/web/package.json`: `@playwright/test` (pinned `1.56.1`, matching this sandbox's pre-installed browser so local verification didn't need a fresh download) and `esbuild` (pinned `0.28.2`). `npm run test:e2e` (→ `playwright test`, with a `pretest:e2e` lifecycle script building the bundle first, same convention as the existing `predev`/`prebuild`) is deliberately **not** part of the root `npm run ci` gate — same treatment the existing `next build` step already gets: a separate, explicit verification step, not folded into the fast local pre-push checks, because installing a browser is heavier than lint/typecheck/unit tests.

## Key decisions

### 1. A pure-arithmetic "expected position" formula, independent of the code under test

The dewarped position of any flat-sheet point could have been computed by re-calling `dewarpFrame`'s own machinery on the expected side too, but that would make the test partly check the code against itself. Instead, `expectedDewarpedPoint` uses the fact that composing the synthetic forward-tilt homography with the real dewarp homography is _exactly_ the same transform as a single flat→destination homography (both are 4-point-correspondence projective transforms, and composing two such transforms through a shared intermediate quadrilateral yields the unique transform between the endpoints) — and since both the flat marker layout and the dewarp's destination rectangle are true axis-aligned rectangles, that direct transform has no perspective/shear term at all, reducing to plain per-axis scale + translate. This is proven in the function's own doc comment and confirmed empirically: the 10°-tilt test case passes with the identical formula the 0°-tilt case uses.

### 2. `retries: 0` in Playwright's config, even in CI

Playwright conventionally sets `retries` for CI runs to absorb ordinary browser-timing flakiness. CLAUDE.md's standing CI rule is explicit and emphatic that an intermittent failure must be root-caused, never retried past ("exactly what this rule exists to prevent"). Given that, I set `retries: 0` unconditionally rather than following Playwright's own convention — a deliberate interpretation of an existing standing rule, not a new policy, but worth surfacing since it's a judgment call rather than something either source directly dictated.

### 3. `HarnessCv` as its own flat interface, not `ArucoCv & PerspectiveCv`

`fixtures.ts` needs members from both `corner-markers.ts`'s `ArucoCv` and `perspective-transform.ts`'s `PerspectiveCv`. Those two interfaces declare incompatible shapes for `Mat`, and the existing codebase's own established pattern (`use-corner-detection.ts`, `use-dewarp.ts`) is to cast the same runtime `cv` object to whichever narrow interface a given call site needs, rather than unify one. `HarnessCv` follows that same pattern instead of trying to force a multiple-interface extension.

## Deviations from the task description

Covered above in Flags #1 and #2 (generator code instead of binary images; scope narrowed to the four true detection-engine modules). Nothing else deviates — the harness runs headlessly in CI against a checked-in fixture set exactly as the task's "done when" criterion states.

## How this was tested

- `npx playwright test` locally: **11/11 passing**, ~7s total.
- `npm run ci` (format, lint, typecheck, test) at the repo root: green, including the existing 111 web + 1 api unit tests, confirmed unaffected (the new `.pw-spec.ts` file's distinct suffix and its own `playwright.config.ts` `testMatch` keep Vitest's default include glob from ever collecting it — confirmed empirically, not just assumed, since a same-named `.spec.ts` file would have collided with Vitest's own default glob).
- Pushed, opened PR #29, watched all three CI jobs (`ci`, `docker-build`, `detection-harness`) to green on head commit `1596809`, cross-checked via both `list_workflow_jobs` and `get_check_runs`, merged (`a7fbdbf`), branch restarted from `main` and push verified via `git fetch` + SHA comparison.
- **A real bug was found and fixed during this verification**, not just a green run reported: `browser-entry.ts`'s initial `waitForCv()` returned the bare `cv` value through an async function's Promise boundary. `opencv-loader.ts`'s own `OpenCvHandle` doc comment specifically documents why that's unsafe — the emscripten Module object has its own `.then()`, so an engine's thenable-resolution check chases it forever. This reproduced exactly as documented: every one of the 11 tests timed out waiting on `cvReady`, and a `ps aux` check found a Chromium renderer process pegged at 100%+ CPU. Wrapping the return value (`{ cv }`, never bare `cv` — matching `OpenCvHandle`'s own established convention) fixed it immediately; all 11 tests passed on the next run. This is exactly the kind of bug this session's insist-on-real-browser-verification discipline exists to catch — a purely logical review of the code would very plausibly have missed it, since the bug is only observable as actual runtime behavior.

## Current status

Done. All 10 of M1's tasks (M1-001 through M1-010) are now complete and merged to `main`. Per CLAUDE.md's standing milestone-gating rule, **M2 is not started** — this report is where this session stops and awaits the founder's explicit go-ahead for the next milestone.

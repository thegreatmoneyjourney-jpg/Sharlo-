# Report: SHARLO-M2-001 — Sharlo stock template library

**Status: implementation complete, verified (unit tests + extended M1-010 harness), merged to `main`.**

---

## 🚩 Flags — read this section first

### 1. "Prints and scans correctly end-to-end" — what was actually verified, and what wasn't

This task cannot include an actual physical print → hand-fill → photograph → scan round trip — that needs a real printer and a real camera, neither of which exists in this sandbox. That physical round trip is explicitly `M1-011`'s job (Addendum 3), not duplicated here. What this task _did_ verify, empirically, not just by construction:

- The exact `DICT_4X4_50` bit pattern for each of the 4 corner marker IDs was extracted from a real `cv.generateImageMarker` call in a real browser (not hand-derived — getting a single cell wrong would have silently broken every printed template's detectability) and cross-checked by feeding that same generated image back through `cv.aruco_ArucoDetector`, confirming it reports the expected ID. All 4 IDs round-tripped correctly.
- The geometry math in `lib/templates/geometry.ts` — where each marker actually ends up on the page — was checked against OpenCV's real detector: the M1-010 detection harness was extended with a new case (`runStockTemplateMarkerCheck`) that draws the real marker bit patterns at the real geometry-computed positions for all 3 stock variants and confirms all 4 markers detect, within a few pixels of subpixel-refinement noise, of their expected positions. See "How this was tested" below.
- The actual generated PDF files were visually inspected (rendered, not just described) for all 3 variants — correct marker placement, legible bubble/label layout, no visual overlap or page-bounds violations.

So "scans correctly" is verified at the level of "the real detection algorithm, given the real marker data this design produces, at the real computed positions, works" — a real, meaningful check, but not the same claim as "a physically printed and photographed copy of this PDF scores correctly," which needs real paper and a real camera and is `M1-011`'s job.

### 2. Geometry format finalized, but the "geometry → live bubble regions" _reader_ is still missing — deliberately, not an oversight

`lib/templates/geometry.ts` defines exactly _where things are_ on a template (marker centers, every bubble's absolute position). Nothing in M1's `lib/scanning` modules yet turns that geometry plus a real dewarped scan frame into the actual bubble regions `sampleBubbleFillRatio` needs — that mapping (using the same marker-rectangle-relative scale/translate technique `tests/detection-harness/fixtures.ts`'s `expectedDewarpedPoint` already proves out) is real, non-trivial work still owed to a later task. Checked `docs/TASKS.md`'s M2 list: no existing task explicitly names this. It most naturally belongs to `M2-004`/`M2-005` (the tasks that actually build the live scan flow and need it to function at all) rather than a new task here — but flagging explicitly, since a future session picking up M2-004 should not be surprised to find this doesn't already exist.

### 3. A real, quantified finding for `perspective-transform.ts`'s placeholder padding ratio

M1-005 left `DEFAULT_PADDING_RATIO = 0.06` (6%) as an explicit placeholder "pending M2-001's real answer." Now that real geometry exists: a 25mm marker on this design's ~155mm marker-to-marker span needs **~8.1%** padding (half the marker's own size, as a fraction of the span) to avoid clipping the marker's own printed footprint in `dewarpFrame`'s output — the current 6% default is a bit short of that. I did **not** change the constant's value — bubble content itself is unaffected either way (every bubble sits inside the marker rectangle, not beyond it, so padding only ever affects whether the _markers'_ own ink survives into the dewarped output, and nothing in the current pipeline re-detects markers post-dewarp). Changing an M1 pipeline constant's value is a real behavior change needing its own re-verification pass, which is out of scope for a template-geometry task — flagging the number so whichever future task first actually needs post-dewarp marker visibility doesn't have to re-derive it.

### 4. Product-shape decisions made as reasonable defaults, not confirmed founder decisions

FR-TPL-01's acceptance criteria only specify question counts (20/50/100) and "documented marker geometry" — everything else was a judgment call, each reasonable but worth surfacing rather than presenting as unquestionably final:

- **A4 page size**, not US Letter — this product's pricing/market focus (Pakistan, Gulf, broader international) is not US-centric, and A4 is the global default outside North America.
- **4 answer options (A-D) per question** — the standard MCQ convention; not verified against any specific curriculum's actual exam format.
- **6-digit roll numbers** — supports up to 999,999 students, comfortably more than any single school needs; easy to widen later (a new `schema_version`, not a breaking change, per `ARCHITECTURE.md` §14).
- **Column layout** (1/2/4 columns for 20/50/100 questions, 20 or 25 rows) — chosen to keep bubbles legible; the 100-question/4-column variant is the tightest (bubbles spaced ~28% wider than the minimum non-overlap distance, vs. much more headroom on the 20/50-question variants) and is the one most worth watching in `M1-011`'s real print-and-fill pass.

None of these block anything — `templates.geometry` is versioned (`ARCHITECTURE.md` §14) specifically so a later adjustment is a new version, not a breaking rework.

---

## What was built

- **`apps/web/lib/templates/aruco-marker-patterns.ts`** — the empirically-extracted, cross-verified `DICT_4X4_50` bit patterns for the 4 corner marker IDs (`arucoDataGridForCorner`, `fullMarkerGrid`), used by both the PDF generator and the new harness verification case — one source of truth for "what a printable marker looks like."
- **`apps/web/lib/templates/geometry.ts`** — `computeStockTemplateGeometry(questionCount)`, pure and parametric: marker positions, every answer bubble's position (4 options × N questions), and the roll-number grid's positions (6 digit columns × 10 options), all in a single top-left-origin, y-down coordinate space shared with the rest of `lib/scanning`. Confirms `lib/scanning/corner-markers.ts`'s M1-003 placeholder marker scheme (same 4 IDs, same dictionary) as final — no detection code changed.
- **`apps/web/lib/templates/geometry.test.ts`** — 17 tests: every bubble (answer + roll-number) stays within the printable page across all 3 variants, no two bubbles are ever closer than a real, legible margin (not just "not literally overlapping" — see the floating-point/exactly-tangent bug this caught and fixed, below), correct question/option/column counts, determinism, and marker-rectangle sanity.
- **`apps/web/lib/templates/generate-pdf.ts`** — renders a `TemplateGeometry` to a PDF via `pdf-lib`: vector-drawn markers (no raster image asset), bubble outlines, question-number/option-letter/roll-number labels.
- **`apps/web/scripts/generate-stock-templates.ts`** + **`run-generate-stock-templates.mjs`** — generates and writes all 3 stock template PDFs plus their seed-data JSON. Bundled via esbuild-for-Node (same pattern `build-detection-harness.mjs` already established for the browser side) rather than relying on Node's still-experimental native TS stripping.
- **Committed outputs**: `apps/web/public/templates/sharlo-{20,50,100}q.pdf` and `apps/web/lib/templates/stock-templates-seed.json` — checked in, not regenerated at build time (see Key Decisions).
- **Extended `apps/web/tests/detection-harness/`** (M1-010's harness): a new `runStockTemplateMarkerCheck` case in `browser-entry.ts` and a new test in `detection-engine.pw-spec.ts`, verifying real OpenCV detection against this task's real marker data at its real computed positions, for all 3 stock variants.
- Updated doc comments in `corner-markers.ts`, `bubble-fill.ts`, `roll-number.ts`, and `perspective-transform.ts` that referenced M2-001 as a future/placeholder-resolving milestone — now pointing at what was actually decided instead of a forward reference.

## Key decisions

### 1. Committed PDF/seed-data outputs, not regenerated at build time

Unlike `opencv.js` (copied) or the M1-010 harness bundle (esbuild output), these PDFs are a real product deliverable, not a build artifact — and a published template's geometry must stay stable forever once a teacher has printed copies of it (regenerating on every deploy would risk silently changing a _live_ template's bubble positions out from under already-printed sheets). `generate:stock-templates` is a manual, deliberate script, not wired into `predev`/`prebuild`; any future layout change is a new `schema_version`, never a silent regeneration of the same template.

### 2. Bubble positions as fractions applied at scan time, not stored as fractions

Every position in `TemplateGeometry` is an absolute PDF-point coordinate, not pre-computed as "a fraction of the marker rectangle." A future scan-time reader derives that fraction on demand (using the exact `expectedDewarpedPoint`-style scale/translate math `tests/detection-harness/fixtures.ts` already proves correct) from whatever two points it needs it for. This keeps the stored geometry simple and matches what a custom, photo-derived template (`M2-003`) will naturally produce too — absolute pixel positions, not pre-normalized ones.

### 3. Real marker bit patterns extracted empirically, never hand-derived

Detailed in Flag 1 — worth repeating here as a key decision, not just a verification note: `DICT_4X4_50`'s dictionary has no public formula, so a hand-typed guess at a bit pattern was never on the table as an option.

## Deviations from the task description

- "Checked into `templates` seed data" is satisfied as a **seed-data artifact** (`stock-templates-seed.json`), not a live database row — the `templates` table itself doesn't exist yet (`M2-002`, not yet built). `M2-002`'s migration is expected to load this file directly.
- No `templates` DB row was created (no table exists yet, per the above) and no admin-panel/UI work was done — this task's scope was geometry + PDF generation only, matching its own title.

## How this was tested

- `npm run ci` (format, lint, typecheck, test) at the repo root — green, including 128 web unit tests (up from 111; 17 new for `geometry.ts`).
- A real bug was caught and fixed by the geometry tests themselves, not just a green run reported: the first version of the roll-number grid spaced adjacent digit bubbles at _exactly_ `2 × radius` apart (mathematically tangent, zero visual gap) — not actually overlapping, but too tight to print legibly, and exactly on a floating-point precision boundary that made the "no overlap" assertion flaky. Fixed by widening the roll-number grid's vertical spacing (a real layout improvement) and tightening the test to require a genuine visible margin (2.1×radius), which is a better test than the original "just don't overlap" one.
- The 3 generated PDFs were read/rendered and visually inspected directly (not just trusted from code) — correct marker placement, legible layout, no overlap, at all 3 question-count variants.
- The extended M1-010 harness (`npx playwright test`) — 12/12 passing, including the new stock-template marker-detectability case across all 3 variants, all under 3px of expected subpixel-refinement noise.

## Current status

Done. Merged to `main`. Continuing directly into `M2-002` (template schema & versioning) next, per the standing autonomous-progress rule for an already-authorized milestone.

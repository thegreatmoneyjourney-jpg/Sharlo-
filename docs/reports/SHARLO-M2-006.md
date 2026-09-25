# Report: SHARLO-M2-006 — Review Needed queue UI

**Status: done, verified end to end (unit tests, component tests, real-browser Playwright pixel verification, and a real dev-server smoke pass), PR open.**

---

## 🚩 Flags — read this section first

### 1. This task also closes M1-009's own forward-referenced "done when" — not scope creep

`docs/TASKS.md`'s M1-009 row (Roll-number grid reading) states its own acceptance bar as "Unmatched/unread roll numbers route to Review Queue, never silently dropped" — but no Review Queue UI existed at M1 time to route to. `exam-scan-flow.tsx` (M2-004) only ever called `readRollNumber`, never surfacing an unreadable roll number anywhere. This task closes that gap along with its own FR-REVIEW-01/02 scope, since building one Review Queue that handles only flagged questions and leaving unreadable roll numbers silently unsurfaced would reproduce the exact "silently dropped" failure M1-009 was written to prevent. Both item kinds share the same queue, the same crop mechanism, and the same non-blocking panel — building them separately would have meant either two parallel UIs or shipping FR-DETECT-04's requirement half-finished.

### 2. Roll-number-item resolution is an interpretation, not a spec-literal implementation

FR-REVIEW-02's wording ("picking the correct answer... or marking 'left blank' / 'invalid, exclude from scoring'") is written specifically for _question_ items — it says nothing about how a roll-number item resolves. This task resolves a roll-number item by having the teacher type the correct number directly (a labeled text input + Save), the only resolution FR-DETECT-04's "route to Review Queue" wording actually supports today: there's no roster/class-list data model anywhere in this codebase yet (a later milestone's job), so there's nothing to pick _from_ the way a question's options can be picked from. Flagging this as a judgment call rather than a silently-assumed reading, consistent with how M2-003 flagged its own ambiguous-wording interpretations.

### 3. Only "unreadable" roll numbers route to review, not "read but not on the roster"

`roll-number.ts`'s `matchRollNumber` already handles a roll number that reads cleanly but doesn't match any roster entry (`status: 'unmatched'`) — but nothing in this codebase calls `matchRollNumber` anywhere, because no roster/class-list exists to match against (same dependency as Flag 2). This task's Review Queue only ever adds a roll-number item for `readRollNumber`'s `status: 'unreadable'` case. Wiring `matchRollNumber`'s `'unmatched'` case in is a small, additive follow-up once rostering exists (a new `ReviewItemSpec` case in `buildReviewItemSpecs`, not a redesign) — flagged here rather than silently assumed already covered.

### 4. Persistence is still deferred — same M3 dependency M2-004/M2-005 already flagged

Everything this task built — the accumulating per-student result list, the review queue, every resolution — lives in React component state for the current session only. Closing the tab or clicking "End exam" loses it, same as the exam/key/results themselves already did before this task. `docs/TASKS.md`'s M3 section (master key generation, local-only mode, encrypted envelope storage) is still entirely unbuilt. This task does not change that boundary; it makes the in-memory session itself materially more complete (a real accumulating gradebook + real review resolution, not just "last scan shown"), which makes the eventual M3 persistence work more valuable to land, not a substitute for it.

### 5. The Review Queue is a non-blocking overlay, not a separate step or route

FR-REVIEW-01/02 don't specify where the queue lives in the flow. Built as a toggleable full-screen overlay on top of the live camera view (a "Review Needed (N)" button the teacher taps between captures) rather than a separate screen the teacher navigates to and from, specifically so resolving items never interrupts the continuous "show sheet → scored → ready for next" loop `M2-005` proved out — a teacher can keep scanning sheets with the queue closed and only open it when they choose to. This is a design decision worth the founder's awareness, not an ambiguity in the requirement text itself.

### 6. Crop padding is a reasonable default, not validated against real photos

`CROP_PADDING_RATIO = 1.5` (`lib/scanning/review-queue.ts`) sizes each crop generously enough to show the printed question number and surrounding bubble row, not just the bare option dots — chosen by inspection of the geometry math, not measured against a real photographed sheet (none exist to test against yet, same honest limitation M2-001/M2-003/M1-010's reports already carry forward). If real-device testing (`M1-011`) surfaces crops that are too tight or too loose to be useful, this is the one constant to revisit.

---

## What was built

- **`lib/scanning/score-answers.ts`** — added `'excluded'` to `QuestionScore`, `excludedCount` to `ScoredSheet` (via a shared `tally()` helper both `scoreSheet` and the new `rescoreSheet` use, so aggregate counts are never hand-rolled twice), and `applyReviewResolution(resolution, keyResult)` implementing FR-REVIEW-02's three resolution actions (`pick` / `mark-blank` / `exclude`).
- **`lib/scanning/review-queue.ts`** (new) — pure, DOM-free: `boundingCropRect` (padded pixel bounding box around a group of mapped bubbles, clamped to the frame) and `buildReviewItemSpecs` (decides which questions are flagged and whether the roll number is unreadable, producing `{kind, cropRect, ...}` specs — never touches a `Canvas` itself, per its own scope-boundary doc comment).
- **`app/(app)/exams/new/use-sheet-reader.ts`** — extended to also compute `rollRead` (moved in from the component) and generate real crop images (`cropToDataUrl`, `drawImage` + `toDataURL`) for every review item, reusing the exact same dewarped canvas the read pass itself built rather than dewarping a second time. Return type changed from `ReadAnswerSheetResult | null` to `SheetReadOutcome | null` (`{result, rollRead, reviewCrops}`).
- **`app/(app)/exams/new/review-queue-panel.tsx`** (new) — the overlay UI: per-item crop image, question resolve controls (A/B/C/.../"Left blank"/"Exclude"), roll-number resolve control (text input + Save), an empty-queue "Fully graded" state.
- **`app/(app)/exams/new/exam-scan-flow.tsx`** — replaced the single ephemeral `lastScan` with an accumulating `students: StudentResult[]` (every sheet scanned this session, `scored` re-derived via `rescoreSheet` on resolution) and a `reviewQueue: ReviewQueueItem[]`; added `resolveQuestionItem`/`resolveRollNumberItem` handlers and a "Review Needed (N)" / "Fully graded" toggle (suppressed until at least one student has actually been scanned — see "Key decisions").
- **Tests**: `review-queue.test.ts` (6, pure logic), `score-answers.test.ts` (+11: `applyReviewResolution`, `rescoreSheet`, `excludedCount`), `exam-scan-flow.test.tsx` (+4: flagged-question pick-resolve, exclude-resolve, roll-number type-resolve, no-vacuous-toggle-before-any-scan — plus the existing 8 updated for `useSheetReader`'s new return shape).
- **Detection harness**: `runReviewCropCase` in `browser-entry.ts` (real detect → dewarp → read → crop pipeline, factored out of the existing `readOneStockSheet` via a new shared `detectDewarpAndRead` helper) and 2 new Playwright cases proving real `Canvas` pixel extraction actually works in a real browser — the one piece of this task jsdom cannot exercise at all (no real Canvas 2D implementation there).

## Key decisions

Covered in the Flags section (M1-009 closure, roll-number-resolution interpretation, no-roster boundary, persistence deferral, non-blocking overlay design, crop padding) — one additional smaller one: the "Review Needed (N)" / "Fully graded" toggle only renders once `mode.students.length > 0`. An earlier version rendered it as soon as `scan-students` phase began, which meant it could show "Fully graded" before a single sheet had actually been scanned — technically true (an empty queue is vacuously fully graded) but misleading, implying work had happened when none had. Caught this myself before it shipped and added a regression test for it (`exam-scan-flow.test.tsx`: "no vacuous toggle before any scan").

## Deviations from the task description

None against `docs/TASKS.md`'s own wording ("Per-exam queue, cropped question image per flagged item, resolve UI... Exam 'fully graded' state requires an empty queue; resolving an item updates the result record") — implemented literally, extended to also cover FR-DETECT-04's roll-number case per Flag 1 above (a closure of an existing forward reference, not new scope this task invented).

## How this was tested

- **Unit tests** (pure logic, no browser): `review-queue.ts`'s `boundingCropRect`/`buildReviewItemSpecs` (in-bounds containment, clamping, correct question numbers, both-kinds-on-one-sheet); `score-answers.ts`'s `applyReviewResolution` (every resolution action against both a resolved and — defensively — an unresolved key) and `rescoreSheet`. 246/246 web tests green.
- **Component tests** (vitest/RTL, every OpenCV/camera hook mocked, same rationale established since M1/M2-004): proved the _real_ `ExamScanFlow`/`review-queue-panel.tsx` state machine end to end — a flagged question reaching the queue, opening the panel, picking the correct answer, the score updating and the queue emptying; the same flow via "Exclude," confirming the denominator drops; an unreadable roll number reaching the queue and resolving via typed input. Caught and fixed a real raw-`.click()`-vs-`fireEvent.click()` timing issue while writing these (same class of bug already found and fixed in `new-exam-client.test.tsx` earlier this milestone — React 19 doesn't guarantee a state update from an un-wrapped `element.click()` has flushed before the next synchronous assertion runs).
- **Real-browser Playwright harness** (`npm run test:e2e`): 25/25 green (23 prior + 2 new), including the 2 new cases that exercise `cropRegionToDataUrl`'s actual `drawImage`+`toDataURL` extraction against a real dewarped frame — proving a real, valid, correctly-sized PNG is produced from real pixels, which no jsdom-based test can verify (jsdom has no real Canvas 2D implementation).
- **Real dev-server smoke pass** (Chromium with `--use-fake-device-for-media-stream`, same precedent as M1-002/M2-004/M2-005): confirmed zero console/page errors through setup → camera-live → key-capture-phase → "End exam", and specifically confirmed the Review Needed/Fully graded toggle correctly does not appear before a key is captured. The fake device's generic test-pattern feed has no real ArUco markers, so — same honest limitation already flagged in M2-004/M2-005 — this proves UI/wiring composition, not that a real flagged item reaches the queue from a real capture; that path is proven by the Playwright harness and component tests above instead.
- `npm run ci` (format, lint, typecheck, test) green locally before pushing.

## Current status

Done. Implementation pushed to `claude/optimistic-allen-9ljry1`; see the PR opened against `main` for CI results before merge, per the standing workflow.

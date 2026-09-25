# Report: SHARLO-M2-007 — Review image retention/purge

**Status: done, verified with a directly-testable pure function plus a component-level wiring proof, PR open.**

---

## 🚩 Flags — read this section first

### 1. The 15-minute retention window is a judgment call, not a confirmed figure — needs founder sign-off

`docs/SRS.md`'s FR-REVIEW-03 and `docs/ARCHITECTURE.md` both say "a short timer" without ever giving a number, and nothing else in either document supplies one by implication. Searched both files for any numeric hint (minutes, TTL, expiry) before picking a value — the only numeric retention windows in this codebase are for unrelated features (`public_result_ttl_days`, STRAI ID expiry) with their own, unrelated rationale. Chose **15 minutes** (`REVIEW_IMAGE_RETENTION_MS`, `exam-scan-flow.tsx`): long enough that a teacher who steps away mid-review (answering a knock at the classroom door, dealing with a student question) doesn't lose their place, short enough to be a real privacy control rather than a token gesture. This is exactly the kind of tunable constant `bubble-fill.ts`'s own `DEFAULT_FILL_THRESHOLDS` doc comment already flags as a category — "not yet validated... needing empirical validation" — flagging it the same way here rather than presenting 15 minutes as settled.

### 2. Purges the image, never the review item itself — this is a deliberate reading of FR-REVIEW-03, not the only possible one

FR-REVIEW-03's wording is about "sheet images... not retained," not about the review obligation. The alternative reading — drop the whole queue item once its image expires — would mean a flagged question a teacher didn't get to in time silently stops needing review, with no record it was ever flagged. That's exactly the "silently dropped" failure `CLAUDE.md`'s core trust guarantee (and M1-009's own FR-DETECT-04 wording, "never silently dropped") exists to prevent for exactly this class of item. This task treats that guarantee as taking precedence over a literal-but-narrower reading of FR-REVIEW-03, and purges only the image: the item stays in the queue, fully resolvable (pick/left-blank/exclude for a question, typed correction for a roll number), just without its visual aid — the panel shows "Image no longer available... you can still resolve this from memory or the roll number below" instead of the `<img>`. Flagging this interpretation explicitly rather than assuming it's the obviously-correct one.

### 3. "Full images" audited — no additional purge mechanism needed, by the existing M1 architecture

`docs/TASKS.md`'s own task title says "Cropped/**full** images." Audited whether the raw captured frame (not just the Review Queue's crops) needs the same treatment: `use-auto-capture.ts` and `use-manual-capture.ts` (both unchanged M1 code) each hold exactly one `capturedFrame` in a single `useState`, overwritten — not appended to a list — on every new capture. A full frame is never retained beyond "the current one being processed," typically milliseconds, and is garbage-collected the instant a newer capture replaces it. This was true before this task and needed no change; noted here as a verified audit finding, not silently assumed.

### 4. IndexedDB purging isn't applicable yet — nothing writes review images there

The done-when criterion says "gone from storage (memory/IndexedDB)." This codebase has never written a review image to IndexedDB anywhere — crops exist only in React component state (in-memory). So there's nothing to purge from IndexedDB today; this flag is a marker for whoever eventually adds IndexedDB caching for review images (if resilience-across-reloads is ever wanted) that the exact same `purgeExpiredCrops` function should be applied there too, not a new gap this task left open.

---

## What was built

- **`app/(app)/exams/new/review-queue-panel.tsx`**: `ReviewQueueItem` gains `addedAt: number` (the `Date.now()` timestamp the item entered the queue — deliberately _not_ the frame's own `capturedAt`, which is a `performance.now()`-relative RAF timestamp incompatible with `Date.now()` arithmetic; a real bug caught before it was ever written, by checking `capture-video-frame.ts`'s actual time source rather than assuming). `cropDataUrl` is now `string | null`. New pure, exported `purgeExpiredCrops(items, now, retentionMs)` — the actual purge logic, with zero timer/DOM dependency of its own so it's directly unit-testable. The panel now renders an "Image no longer available" placeholder (with working resolve controls) when `cropDataUrl` is null.
- **`app/(app)/exams/new/exam-scan-flow.tsx`**: sets `addedAt` when a review item is created; a new `useEffect` runs `purgeExpiredCrops` on a 30-second interval (`RETENTION_CHECK_INTERVAL_MS`) for the whole `scan-students` phase, independent of whether the panel is open — this is about not _retaining_ data, not just not _displaying_ it.
- **Tests**: `review-queue-panel.test.tsx` (new, 9 cases) — `purgeExpiredCrops` directly: untouched within the window, purged at/after the cutoff, item and every other field preserved, idempotent, mixed fresh/stale queue, both item kinds, reference-equality preserved when nothing changed, empty queue. `exam-scan-flow.test.tsx` (+1) — a component-level test proving the real wiring: captures the actual `setInterval` callback the component registers and invokes it directly with `Date.now()` mocked forward past the window, confirming the image disappears, the item and its resolve controls remain, and the item is still genuinely resolvable afterward.

## Key decisions

Covered in the Flags section (the retention-window figure, image-vs-item purging, the full-images audit, the IndexedDB non-applicability) — one additional smaller one: deliberately avoided `vi.useFakeTimers()` for the component test. Mixing fake timers with `@testing-library`'s own `setTimeout`-based async polling (`findBy*`/`waitFor`) is a known source of flaky or hanging tests, which `CLAUDE.md`'s CI rules treat as something to root-cause, not route around. Capturing and directly invoking the registered `setInterval` callback (with `Date.now()` mocked) proves the exact same wiring without that risk.

## Deviations from the task description

None against `docs/TASKS.md`'s own wording. The image-vs-item purge distinction (Flag 2) and the retention-window figure (Flag 1) are judgment calls on ambiguous/unspecified points, not deviations from anything the task explicitly specified.

## How this was tested

- **Unit tests** (pure logic, no browser, no timers): `purgeExpiredCrops`'s full behavior — 9/9 green.
- **Component test** (vitest/RTL): the real `setInterval`-registration-and-invocation proof described above — confirms the actual production wiring, not just the isolated function. 256/256 web tests green (246 prior + 9 new pure-function tests + 1 new component test).
- **API tests**: 13/13 green against a real local Postgres (unaffected — this task touches no API/schema code).
- **Real-browser Playwright harness**: 25/25 green, unchanged from M2-006 — this task's changes are UI/component-layer only, nothing the OpenCV pipeline harness exercises.
- **Real dev-server smoke pass** (Chromium fake-camera-device flags, same precedent as M1-002/M2-004 through M2-006): zero console/page errors through setup → camera-live → key-capture-phase → "End exam."
- `npm run ci` (format, lint, typecheck, test) green locally before pushing.

## Current status

Done. Implementation pushed to `claude/optimistic-allen-9ljry1`; see the PR opened against `main` for CI results before merge, per the standing workflow.

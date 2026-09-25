# Report: SHARLO-M2-008 — Duplicate-sheet detection

**Status: done for the requirement's literal, testable done-when criterion; one materially harder alternative detection path explicitly scoped out, not silently skipped. PR open.**

---

## 🚩 Flags — read this section first

### 1. FR-DETECT-05's "or a matching visual fingerprint" is explicitly out of scope — not silently dropped

`docs/SRS.md`'s FR-DETECT-05 description names two ways a duplicate could be caught: "same exam + same roll number, **or a matching visual fingerprint**." The task's own `done when` criterion, however, only names one: "Rescanning the same roll number for the same exam triggers a warning before it's saved." This task builds exactly that — roll-number matching, fully — and treats visual-fingerprint matching (catching a genuine re-scan of the same physical sheet even when the roll number is misread differently between the two scans, e.g. a detection-noise digit flip) as a separate, materially harder feature: it would need its own perceptual-similarity algorithm across dewarped frames, with the same kind of empirical algorithm-choice justification `detect-sheet-boundary.ts` (M2-003) needed before being trusted, not a same-task afterthought bolted on to check a box. Building a rushed, unvalidated version would risk either false "duplicate" warnings on two genuinely different students' sheets, or false confidence that duplicates are being caught when they aren't — both worse than clearly not having the feature yet. Flagged for a future, dedicated task rather than assumed covered.

### 2. A confirmed rescan replaces the prior entry, not adds a second one — a judgment call, not spec-literal

Neither FR-DETECT-05 nor this task's `done when` says what "override with rescan intentionally" actually does to the data once confirmed. Two readings are defensible: (a) replace the existing student's saved result with the new scan, or (b) keep both as separate entries and let the teacher sort it out later. This task implements (a): the new capture overwrites the prior entry for that roll number, and any review-queue item still pending for the _superseded_ scan is dropped along with it (a stale review item pointing at a scan that no longer exists would be worse than no item at all). Reading (a) is the one that keeps `students[]` at exactly one entry per roll number at all times — a simpler, less error-prone invariant for whatever downstream work (M2-009 batch import, eventual results persistence) ends up relying on that list. Flagging this as the interpretation taken, not an assumed-obvious one.

### 3. Built directly against the in-memory per-session results list, not a "synced results index" — same persistence deferral already established

FR-DETECT-05's own acceptance note says the check runs "against the already-synced results index for that exam." No synced index exists — there is still no persistence layer anywhere in this codebase (M3 unbuilt), the same dependency M2-004 through M2-007 have each already flagged. This task checks against `exam-scan-flow.tsx`'s own in-memory `students[]` (built in M2-006) — everything scanned so far _this session_, which is the only "index" that currently exists. Once M3 lands and results genuinely sync, this same check should extend to cover results from _other_ devices/sessions for the same exam, not just the current one — flagged as a natural follow-up, not a gap this task quietly left uncovered.

---

## What was built

- **`app/(app)/exams/new/exam-scan-flow.tsx`**: a new `PendingDuplicate` state (`{ rollNumber, newStudent, newQueueItems }`). Before a freshly-read capture is saved into `students`/`reviewQueue`, its roll number (when successfully read) is checked against every already-saved student's roll number; a match holds the capture in `pendingDuplicate` instead of saving it — "triggers a warning before it's saved" means exactly that, nothing about the new capture is committed until the teacher acts. While a decision is pending, further captures are ignored (checked at the top of the capture-processing effect) rather than silently interfering with the held one. A full-screen, high-priority prompt (`role="alertdialog"`, rendered above the Review Queue panel) shows the roll number and two actions: **Cancel** (discards the pending capture entirely — nothing saved) and **Rescan intentionally** (replaces the prior entry for that roll number, dropping its now-orphaned review-queue items, per Flag 2 above).
- **Tests** (`exam-scan-flow.test.tsx`, +4): duplicate roll number triggers the prompt and holds the save (the display still shows the _first_ scan's result); Cancel discards cleanly, leaving the original untouched; confirming replaces the entry and clears the superseded scan's own review item; a genuinely different roll number never triggers the prompt.

## Key decisions

Covered in the Flags section (visual-fingerprint scope boundary, replace-vs-add-second-entry, in-memory-vs-synced index) — not repeated here.

## Deviations from the task description

None against `docs/TASKS.md`'s own wording, which this task implements literally. Found and fixed one real interaction with the _existing_ M2-005 continuous-scan-loop stress test along the way: that test cycled a single-digit roll number (`i % 10`) across 30 iterations, meaning sheet 10 legitimately repeated sheet 0's roll number — a real collision only surfaced once M2-008's own duplicate gate existed to notice it. Fixed by giving that test two digit columns (genuinely unique "00".."29" across all 30 sheets), since that test's own actual concern (score/state independence across a long run) has nothing to do with roll-number semantics and shouldn't incidentally start exercising a different feature's confirmation flow.

## How this was tested

- **Component tests** (vitest/RTL): the 4 new cases above, proving the real state machine — the prompt appearing/holding the save, Cancel, confirm-and-replace (including the orphaned-review-item cleanup), and the negative case (different roll number, no prompt). Full web suite: 260/260 green (256 prior + 4 new).
- **API tests**: 13/13 green against a real local Postgres (unaffected — no API/schema code touched).
- **Real-browser Playwright detection harness**: 25/25 green, unchanged (this task is UI/component-layer only, nothing the OpenCV pipeline harness exercises).
- **Real dev-server smoke pass** (Chromium fake-camera-device flags, same precedent as M1-002 through M2-007): zero console/page errors through setup → camera-live → key-capture-phase → "End exam."
- `npm run ci` (format, lint, typecheck, test) green locally before pushing.

## Current status

Done. Implementation pushed to `claude/optimistic-allen-9ljry1`; see the PR opened against `main` for CI results before merge, per the standing workflow.

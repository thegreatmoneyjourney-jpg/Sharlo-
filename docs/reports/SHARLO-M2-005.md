# Report: SHARLO-M2-005 — Continuous student-sheet scan loop UX

**Status: done for everything a Claude Code session can independently verify; one honestly-scoped physical-world gap flagged below, non-blocking.**

---

## 🚩 Flags — read this section first

### 1. The "zero clicks" mechanism itself was already fully built — by M1-003/004/007/008 and M2-004, not by this task

Before writing anything new, I audited what M2-004's `exam-scan-flow.tsx` already inherits, unchanged, from the M1 scanning pipeline:

- Continuous per-frame corner detection (M1-003) and the stability gate (M1-004): `StabilityGate.update()` only fires a capture once 4 corners hold within tolerance for the full stability window, then latches into `cooldown` (`awaitingRemoval = true`) so the _same_ held-still sheet never re-triggers — it only re-arms once detection goes incomplete (the sheet is physically pulled away). This re-arm behavior already has its own dedicated test (`stability-gate.test.ts`: "re-arms after the sheet is removed and can capture again").
- Capture feedback (M1-007): `playCaptureFeedback()` (beep + vibration) is called from _inside_ `useAutoCapture` itself (`use-auto-capture.ts:72`), not from any page component — so every page that uses the hook gets it automatically. `exam-scan-flow.tsx` calls `useAutoCapture(videoRef)` exactly like `scan-client.tsx` does, so this "captured, safe to move on" signal was already firing for student scans with zero additional wiring needed.
- Manual "Take Photo" fallback (M1-008): reused unchanged via `useManualCapture`.
- Automatic dewarp → map → read → score on every new capture, zero manual steps (M2-004's `useSheetReader` + `exam-scan-flow.tsx`'s capture-keyed effect): already built last task.

So the literal mechanism behind "show sheet → scored → ready for next, zero clicks" was already complete before this task started. What was genuinely missing — and is this task's real contribution — is **verification that it holds up over a long continuous run**, which is exactly what the done-when criterion ("scan a full class of 30+ sheets back-to-back") is actually testing for: not whether the loop works once, but whether it keeps working correctly 30 times in a row without degrading, leaking, or corrupting state.

### 2. "Manual QA: scan a full class of 30+ sheets back-to-back" has a real-world half this session cannot perform, and an automatable half it can — I did the second, and I'm not conflating it with the first

Same category of constraint `M1-011` already established and the founder already confirmed doesn't block engineering progress: a Claude Code session has no physical camera, no printed paper, and no hands to hold sheets up to a lens. The literal instruction — an actual teacher scanning an actual stack of 30+ real, physically-swapped answer sheets with a real phone camera in one real sitting — cannot be performed here, and I'm not claiming it was.

What **is** fully within this session's power, and what I judged to be the actual point of a 30-sheet stress requirement (catching bugs that only manifest under repetition — accumulating state, resource leaks, stale closures — as opposed to bugs a single-shot test already catches): proving the entire software pipeline downstream of "a stable frame was captured" survives 30 distinct, consecutive sheets with zero errors and zero drift. Built two independent stress tests for this (see "What was built"), both passing clean.

**Recommendation, not a unilateral scope change:** the literal physical walkthrough this task's done-when criterion describes is naturally a superset of what `M1-011`'s real-device validation pass already has to do anyway (real phone, real printed sheets, real hands, measuring real accuracy over a meaningful sample) — running that pass as a genuine continuous multi-sheet session rather than isolated single-sheet captures would satisfy both tasks' physical-world requirements in one pass. I haven't modified `M1-011`'s own task text (it's already founder-confirmed) — flagging the overlap here for whoever executes it.

### 3. No new UX affordance was added, after auditing for a real gap and finding none

Considered adding a "Scoring…" transitional indicator for the brief window between a capture landing and `useSheetReader`'s async result resolving. Declined: capture feedback (beep/vibration) already fires synchronously the instant the stability gate captures, independent of how long reading/scoring takes — that's the actual "safe to move to the next sheet" signal a teacher not looking at the screen relies on, and it doesn't wait on the read pipeline. The read/score pipeline itself is a handful of synchronous WASM calls (no network round trip), so the resolve gap is not perceptible in practice. Adding a transitional state for a gap nothing in the loop actually depends on would be complexity without a real problem behind it.

Also audited whether a running per-session tally (e.g., "14 of 30 scanned") belongs in this task. Decided no: `docs/TASKS.md`'s own wording for this task is specifically about the single-sheet capture-to-ready _cycle_, not a roster/summary view, and a persisted list of scanned students is naturally `M2-008`'s territory (duplicate-sheet detection explicitly needs "the synced results index for the exam" to compare against) and ultimately depends on the same M3 persistence layer M2-004 already flagged as not yet built. Adding an in-memory-only counter now, ahead of the feature it actually serves, would be scope creep against this task's own description.

---

## What was built

- **`tests/detection-harness/browser-entry.ts`**: refactored `runFullStockSheetReadCase`'s body into a standalone `readOneStockSheet()` helper (detect → dewarp → map → read for one sheet), so a new `runContinuousScanStressCase(spec)` can call the exact same production code path in a loop rather than a second, drifting copy of it. Added `answersForStressIndex()` — a deterministic (not random) per-sheet answer pattern generator, so a failure at sheet N is exactly reproducible.
- **`tests/detection-harness/detection-engine.pw-spec.ts`**: new `continuous scan-loop reliability (M2-005, Kickoff §1 core promise)` case — runs 30 distinct sheets through the real detect→dewarp→map→read pipeline in a single browser/cv session and asserts every single one reads back exactly correctly, with a per-sheet labeled assertion (`sheet N of 30`) so a failure at any point names exactly which iteration broke.
- **`app/(app)/exams/new/exam-scan-flow.test.tsx`**: new test simulating 30 consecutive student captures through `ExamScanFlow`'s real state machine (capture key once, then 30 rerenders each with a distinct mocked read result), asserting the displayed score and roll number update correctly and independently every time — a varying correct-count (cycling 0–20) and roll digit per sheet, specifically so a stuck/stale display would show a _wrong_ number rather than coincidentally the right one.

## Key decisions

Covered in the Flags section (what was already built vs. new; the real-world/automatable split of "manual QA"; the considered-and-declined UX additions) — not repeated here.

## Deviations from the task description

None against `docs/TASKS.md`'s own wording. The done-when criterion's physical-world half is addressed by an honest flag (Flag 2) rather than a false claim of having performed it, consistent with `M1-011`'s already-established precedent for the same class of constraint.

## How this was tested

- **Playwright detection harness** (`npm run test:e2e`, real headless Chromium + OpenCV WASM): the new 30-sheet stress case passes clean (~10s for the full run) — every one of 30 distinct sheets (different answer pattern and roll number each time) reads back exactly correctly, proving no cumulative drift, no exception, and no resource-cleanup failure (every `Mat` allocated per iteration is deleted the same way the single-shot case already does) across a long run within one session. Full suite: 23/23 green (22 prior + 1 new).
- **Component tests** (vitest/RTL): the new 30-capture stress test in `exam-scan-flow.test.tsx` passes clean — every one of 30 consecutive captures shows the correct, distinct score and roll number, confirming `ExamScanFlow`'s own state machine (`processedAtRef`, `mode.lastScan`) doesn't bleed state between sheets over a long run. Full web suite: 230/230 green (229 prior + 1 new).
- Re-confirmed `stability-gate.test.ts`'s existing "re-arms after the sheet is removed and can capture again" case still passes unmodified — the mechanism this task's UX promise actually depends on was not touched, only verified.
- `npm run ci` (format, lint, typecheck, test) green locally before pushing, plus the detection harness suite run separately (its own CI job).

## Current status

Done. Implementation pushed to `claude/optimistic-allen-9ljry1`; see the PR opened against `main` for CI results before merge, per the standing workflow.

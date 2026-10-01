# SHARLO-M3-008 — Results table UI

**Status: done.** Builds `FR-RESULTS-01`/`FR-RESULTS-02` on the `M3-006` envelope primitives and the `M3-007` master-key session cache, and closes the "save this exam" gap `M2-004` through `M3-007` all left as an in-memory-only, discarded-on-restart scan session.

## Flags

1. **A stray `"examKey"` envelope-type mention in `ARCHITECTURE.md` §7 — resolved by reading the product's own usage pattern, not escalated.** §7's illustrative envelope-type comment listed `examResults`, `examKey`, `roster`, and `template` as the possible `type` values, but nothing in `docs/SRS.md` or `docs/TASKS.md` ever called for a key to be persisted separately from the results it scores — a key is captured once, immediately before scanning students against it, and this task's own row (`M3-008`) only ever describes one thing to save: "this exam." Resolved the same way the `M3-007` roster-granularity question was resolved (reading the docs' own reasoning pattern, in this case `ARCHITECTURE.md`'s own adjacent "not splitting by student" granularity note): one envelope per exam, type `examResults`, holding the captured key and every student's scored sheet together. A separate `examKey` envelope would need its own linkage back to its results for no real benefit this product would ever exercise. `ARCHITECTURE.md` §7 updated to remove the stray mention and document the resolution inline. Not a stop condition — a normal, well-constrained judgment call resolvable from the existing docs alone, recorded as a Key Decision below rather than in §15's founder-escalated resolution log.
2. **Not verified against a real device, a real Google Drive account, or a real class-sized exam** — the same category of gap `M1-011` (real-device scanning), `M3-001` (real iOS Safari), and `M3-006`/`M3-007` (real Drive account) already carry for this project, not a new one specific to this task. Every test here uses synthetic fixtures and a fake in-memory `EnvelopeStore`; the no-debounce-save-on-every-edit design (see Key decisions) is reasoned from WebCrypto AES-GCM's known performance characteristics, not measured against a real multi-hundred-student class on a real budget device.

## What was built

**`apps/web/lib/exams/` (new directory):**

- `exam-results.ts` — the `examResults` envelope: `StudentResult` (relocated here from `app/(app)/exams/new/exam-scan-mode.ts`, see Key decisions), `ExamResults` (`recordId`, `title`, `questionCount`, `key: QuestionResult[]`, `rosterId: string | null`, `students: StudentResult[]`, `createdAt`), and `saveExamResults`/`listExamResults`/`loadExamResults` — a thin wrapper over the `M3-006` envelope primitives, dependency-injected (`EnvelopeStore` + master-key `Bytes`), mirroring `roster-store.ts`'s established shape exactly.
- `question-breakdown.ts` — `computeQuestionBreakdown(students, questionCount)`: per-question `correctCount`/`incorrectCount`/`needsReviewCount`/`excludedCount`/`correctPercent`, with the percent's denominator excluding both `excludedCount` and `needsReviewCount` (only `correct` + `incorrect` count as "known"), returning `null` when that denominator is 0.
- `results-grid-ops.ts` — the pure data-operations half of the editable grid: `updateStudentName`, `updateStudentRollNumber` (empty string normalizes to `null`), `updateQuestionScore` (re-tallies the affected student's scored sheet via the existing `rescoreSheet`), `addBlankStudent` (all questions start `needs-review`), `removeStudent`.

**`apps/web/app/(app)/` (new):**

- `results-grid.tsx` — `ResultsGrid({students, questionCount, onChange})`: the presentation half — name/roll-number text inputs, one Correct/Incorrect/Needs-review/Excluded `<select>` per question, a computed Total column, per-row Remove, and an "Add student" button. Split from `results-grid-ops.ts` matching the existing `review-queue.ts`/`review-queue-panel.tsx` convention.
- `exams/page.tsx` + `exams/exams-list-client.tsx` — the minimal saved-exams list (title, date, student count) proving persistence round-trips at all; loads behind `RequireMasterKey`, sorted newest-first, links to `/exams/new` and to each exam's own page.
- `exams/[id]/page.tsx` + `exams/[id]/exam-results-client.tsx` — the Results Table itself. Awaits the Next.js 16 `params: Promise<{id: string}>` server-side (confirmed against the installed package's own docs, per `apps/web/AGENTS.md`'s explicit warning not to assume training-data conventions here) and passes `examId` down as a plain string prop. The client component loads the exam behind `RequireMasterKey`, renders `ResultsGrid` plus a per-question breakdown summary, and re-saves the whole envelope on every grid edit with a small saving/saved/error status indicator (with a Retry button on error).

**`apps/web/app/(app)/exams/new/` (modified):**

- `exam-scan-mode.ts` — `StudentResult` removed in favor of re-exporting it from `lib/exams/exam-results.ts` (see Key decisions).
- `exam-scan-flow.tsx` — `onRestart: () => void` renamed `onEndExam: (mode: Mode) => void`; the component makes no save/discard decision itself, it only hands its current `mode` up to the caller.
- `new-exam-client.tsx` — `ExamSetup` gained `questionCount`/`rosterId`; a new `handleEndExam` branches on `mode.phase` (`capture-key` → unchanged pure discard; `scan-students` → a new `RequireMasterKey`-gated `SaveExamStep` with an explicit "Save and view results" button that mints `crypto.randomUUID()` as the `recordId`, calls `saveExamResults`, and hard-redirects to `/exams/${recordId}`, plus a "Cancel" that discards back to setup).

## Key decisions

- **One envelope per exam, type `examResults`, key and students together** — see Flag 1.
- **`StudentResult` moved to `lib/exams/exam-results.ts`** — `lib/` must never depend on `app/`, and the persistence layer (`lib/`) needs the type as much as the scan-mode state machine (`app/`) does; `exam-scan-mode.ts` re-exports it so no existing import site had to change.
- **The editable grid is built as the reusable component `FR-IMPORT-06` (`M11`) will need a second call site for, not a bespoke table** — `results-grid.tsx`/`results-grid-ops.ts`'s split mirrors `review-queue.ts`/`review-queue-panel.tsx`'s existing precedent. Scope kept to exactly `FR-IMPORT-06`'s literal wording (name/roll-number/per-question-mark editing, row add/delete) — "not a general spreadsheet/Word clone."
- **No debounce — every grid edit re-encrypts and re-saves the whole exam envelope immediately** — a deliberate simplicity choice; WebCrypto AES-GCM on a class-sized record is fast enough that batching would only add complexity (a timing/flush-on-navigate edge case) for no measured win. Revisit only with real evidence from a real class size, not a hunch (see Flag 2).
- **The per-question breakdown is scoped to the tally only, not difficulty ranking** — `computeQuestionBreakdown`'s output is designed to be reused as-is by `FR-RESULTS-03`'s "hardest questions" (`M3-009`), not recomputed there.
- **"End exam" now makes a real save-or-discard decision instead of always discarding** — `capture-key` phase (nothing captured yet) stays a silent discard; `scan-students` phase requires an explicit, master-key-gated click to save, never an automatic save on unlock.

## Deviations from the original task description

None against `M3-008`'s own row (`docs/TASKS.md`: "Editable spreadsheet-like view: name/roll fix-up, per-question breakdown... build this as the reusable editable-grid component `FR-IMPORT-06` later requires"). The exam-persistence mechanism (saving on "End exam," the `/exams` list, the `examResults` envelope itself) is additional infrastructure this task's own save-then-display requirement made unavoidable — there was nothing to show a Results Table _for_ without it — not scope added independently of the task.

## How it was tested

- **`lib/exams/exam-results.test.ts`**: round-trip through a fake in-memory `EnvelopeStore`, overwrite-in-place on re-save with the same `recordId`, listing multiple exams, decrypt failure with the wrong master key.
- **`lib/exams/question-breakdown.test.ts`**: a hand-calculated fixture (3 students × 3 questions), empty-class and all-excluded/needs-review null-percent cases, a missing per-student entry skipped rather than treated as incorrect.
- **`lib/exams/results-grid-ops.test.ts`**: full coverage of all five operations, including `updateQuestionScore`'s re-tally and `addBlankStudent`'s all-`needs-review` initial state.
- **`app/(app)/results-grid.test.tsx`**: renders rows, name/roll edits call `onChange`, a question-select change re-tallies, Add/Remove buttons work.
- **`app/(app)/exams/exams-list-client.test.tsx`**: empty state, listing/sorting/link-`href`s, error state.
- **`app/(app)/exams/[id]/exam-results-client.test.tsx`**: not-found, error, renders title/grid/breakdown, editing re-saves, save failure shows the Retry affordance.
- **`app/(app)/exams/new/exam-scan-flow.test.tsx`**, **`new-exam-client.test.tsx`**: the `onRestart` → `onEndExam` rename across every existing assertion, plus three new cases — ending with nothing captured still discards exactly as before, ending a scan-students session saves and redirects to the new exam's results page with the expected `saveExamResults` payload, and "Cancel" on the save step discards without saving.
- **Full-suite regression + `npm run ci`**: both workspaces green against real Postgres (format:check, lint, typecheck, test).

## Current status

Done, with Flag 2's real-world verification gap explicitly acknowledged rather than glossed over — the same category of gap this project already carries for `M1-011`, `M3-001`, `M3-006`, and `M3-007`, not a new one specific to this task's own rigor.

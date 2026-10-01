# SHARLO-M3-009 — Class analytics

**Status: done.** Builds `FR-RESULTS-03` on top of `M3-008`'s `examResults` envelope and its `computeQuestionBreakdown` function.

## Flags

1. **`FR-RESULTS-03` is Pro/School-only with zero Free-tier allowance (`docs/SRS.md` §5.9a's feature-gating table), and this task ships it fully reachable by every account anyway — a deliberate judgment call, not an oversight, resolved without escalating to the founder.** No entitlement-check layer exists anywhere in this codebase yet — that's `M4-005`, a future task, and `M3`'s own milestone comes entirely before `M4` in build order. Rather than invent ad-hoc gating logic for this one feature (which `M4-005` would then have to find and rip out again), or hold the feature back entirely pending a question that doesn't actually block correct implementation, I followed the precedent this project has already set and the founder has already implicitly accepted: `FR-TPL-02` (custom templates, zero Free-tier allowance, same as this FR) shipped fully ungated in `M2-003`, and `M2` as a whole was confirmed done by the founder afterward — meaning the founder has already seen and accepted an ungated zero-free-allowance Pro feature live in the app. `M4-005`'s own `docs/TASKS.md` row explicitly names itself as the retrofit point for "client-only gated features," so this task's own `lib/exams/class-analytics.ts` and its UI call site say in their own doc comments, explicitly, that they're following that same precedent and are waiting on that same retrofit — rather than silently leaving a future session to rediscover that this feature needs gating at all. `CLAUDE.md`'s decisions log adds a pointer so `M4-005` doesn't miss this (and `M2-003`) when it comes time to retrofit gates, since `M4-005`'s task description only names `M8`–`M11` by example, not `M3-009`/`M2-003`.
2. **Not verified against a real class-sized dataset or a real device** — the same category of gap `M1-011`, `M3-001`, `M3-006`/`M3-007`, and `M3-008` already carry for this project, not a new one. Every test here uses a small, synthetic, hand-calculated fixture.

## What was built

**`apps/web/lib/exams/class-analytics.ts` (new):**

- `computeClassAnalytics(students, questionCount)` returning `{ hardestQuestions, weakestStudents, scoreDistribution, unscoredStudentCount }`.
- `hardestQuestions`: `computeQuestionBreakdown`'s own output (`M3-008`), re-sorted ascending by `correctPercent` (hardest/lowest first) — not recomputed.
- `weakestStudents`: one entry per student (`id`, `rollNumber`, `name`, `correctCount`, `knownCount`, `correctPercent`), `knownCount` = `correctCount + incorrectCount` (same known-answers-only denominator `question-breakdown.ts` already established), sorted ascending by `correctPercent` (weakest/lowest first).
- `scoreDistribution`: ten fixed 10-point buckets (0–10 through 90–100) tallying how many students fall in each, by `correctPercent`. A 100% score is clamped into the last bucket rather than computing a nonexistent 11th. Students with no known answers at all (`correctPercent === null`) are excluded from every bucket and counted in `unscoredStudentCount` instead of silently vanishing.
- Both rankings sort `null`-percent entries (no known-answer data at all) to the end via a shared `rankValue`/`byAscendingPercent` helper.

**`apps/web/app/(app)/exams/[id]/exam-results-client.tsx` (modified):**

- New `ClassAnalyticsView` component, rendered directly below the existing `QuestionBreakdownView` on the same page. Shows the top 5 hardest questions, top 5 weakest students, and every non-empty score-distribution bucket (plus the unscored-student count when non-zero), computed via `computeClassAnalytics` alongside the existing `computeQuestionBreakdown` call.
- The hardest-questions line uses different wording from the existing per-question-breakdown line (`"Q{n} — {percent}% got it right"` vs. `"Q{n}: {percent}% correct"`) — seeded by hitting a real `getByText` ambiguity between the two sections during test-writing, not anticipated speculatively.

## Key decisions

- **Shipped ungated, following the `M2-003` custom-templates precedent** — see Flag 1.
- **`hardestQuestions` reuses `computeQuestionBreakdown`'s tally rather than recomputing it** — exactly the forward reference that function's own `M3-008` doc comment left open.
- **The score-distribution bucket width is a fixed 10 points, not configurable** — simplest thing that satisfies "score distribution" as stated; revisit only if a real need for a different granularity shows up.
- **A student with no known answers at all is excluded from the distribution and surfaced separately (`unscoredStudentCount`) rather than silently absent** — consistent with this project's general stance (`question-breakdown.ts`, the Review Queue) of never letting an unresolved/unknown case quietly disappear from a tally.
- **The UI shows only the top 5 of each ranked list, with the full lists available from the pure function for a future "see all" affordance** — not needed yet, and the computation doesn't have to change to add it later.

## Deviations from the original task description

None against `M3-009`'s own row (`docs/TASKS.md`: "Hardest questions, weakest students, score distribution — computed client-side," done-when "Verified against a known fixture dataset with hand-calculated expected stats"). The gating question (Flag 1) is a scope question the row itself doesn't mention either way, not a deviation from what it does say.

## How it was tested

- **`lib/exams/class-analytics.test.ts`**: a hand-calculated 4-student/3-question fixture (including one student with zero known answers) verifying `hardestQuestions` ranking, `weakestStudents` ranking, bucket placement, and `unscoredStudentCount`; a dedicated test for the 100%-score/last-bucket edge case; an empty-class test confirming no division-by-zero and all-zero buckets.
- **`app/(app)/exams/[id]/exam-results-client.test.tsx`**: extended with a new test asserting the rendered hardest-question line, weakest-student line, and distribution-bucket line against the page's existing single-student fixture.
- **Full-suite regression + `npm run ci`**: both workspaces green against real Postgres (format:check, lint, typecheck, test).

## Current status

Done, with Flag 1's gating precedent and Flag 2's real-world verification gap both explicitly surfaced rather than glossed over.

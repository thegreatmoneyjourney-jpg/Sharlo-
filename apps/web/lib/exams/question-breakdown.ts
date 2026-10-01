import type { StudentResult } from './exam-results';

/**
 * `M3-008` (`FR-RESULTS-02`): "per-question breakdown view (e.g., % of
 * class that got Q7 right)," computed client-side from already-decrypted
 * exam data. Deliberately just the per-question tally — ranking
 * questions by difficulty or students by weakness is `FR-RESULTS-03`'s
 * job (`M3-009`), which can reuse this function's output rather than
 * recomputing the same tally; not built speculatively here.
 */
export interface QuestionBreakdown {
  /** 1-based, matching how questions are numbered everywhere else in this app. */
  questionNumber: number;
  correctCount: number;
  incorrectCount: number;
  needsReviewCount: number;
  excludedCount: number;
  /**
   * Percent of students who got this question correct, among students
   * whose answer to it was actually known (`correct` or `incorrect`) —
   * `excludedCount` and `needsReviewCount` are excluded from the
   * denominator, same reasoning `rescoreSheet`'s own doc comment gives
   * for a per-student tally: a void/unresolved question was never a
   * fair test for anyone. `null` when nobody has a known answer to this
   * question at all (an empty class, or every entry excluded/unresolved),
   * so the caller never divides by zero or has to guess what "0 of 0" means.
   */
  correctPercent: number | null;
}

/**
 * `students` need not all share the same `scored.scores.length` in
 * theory, but in practice every student in one exam was scored against
 * the same key — a student missing an entry for a given question index
 * (e.g. a malformed record) is skipped for that question rather than
 * thrown on, the same defensive stance `scoreQuestion` already takes
 * for its own inputs.
 */
export function computeQuestionBreakdown(
  students: readonly StudentResult[],
  questionCount: number,
): QuestionBreakdown[] {
  return Array.from({ length: questionCount }, (_, i) => {
    let correctCount = 0;
    let incorrectCount = 0;
    let needsReviewCount = 0;
    let excludedCount = 0;

    for (const student of students) {
      const score = student.scored.scores[i];
      if (!score) continue;
      if (score.outcome === 'correct') correctCount++;
      else if (score.outcome === 'incorrect') incorrectCount++;
      else if (score.outcome === 'needs-review') needsReviewCount++;
      else excludedCount++;
    }

    const knownCount = correctCount + incorrectCount;
    return {
      questionNumber: i + 1,
      correctCount,
      incorrectCount,
      needsReviewCount,
      excludedCount,
      correctPercent: knownCount === 0 ? null : (correctCount / knownCount) * 100,
    };
  });
}

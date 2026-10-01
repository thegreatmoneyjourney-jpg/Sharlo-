import type { StudentResult } from './exam-results';
import { computeQuestionBreakdown } from './question-breakdown';
import type { QuestionBreakdown } from './question-breakdown';

/**
 * `M3-009` (`FR-RESULTS-03`): "hardest questions, weakest students, score
 * distribution," computed client-side from the same already-decrypted
 * exam data `FR-RESULTS-02` (`M3-008`) uses. `hardestQuestions` reuses
 * `computeQuestionBreakdown`'s own tally rather than recomputing it, per
 * that function's own forward-reference doc comment.
 *
 * Per `docs/SRS.md` §5.9a, this FR is Pro/School-only (zero Free-tier
 * allowance) — same shape as `FR-TPL-02` (custom templates, `M2-003`).
 * No entitlement-check layer exists yet (that's `M4-005`, which also owns
 * retrofitting the actual plan gate onto this and every other
 * already-shipped Pro-only feature, `M2-003` included); this module and
 * its one call site are deliberately left ungated for now, consistent
 * with how `M2-003` already shipped.
 */

export interface WeakestStudent {
  id: number;
  rollNumber: string | null;
  name: string | null;
  correctCount: number;
  /** `correctCount + incorrectCount` — the same known-answers-only denominator `correctPercent` is computed against. */
  knownCount: number;
  /** `null` when this student has no known (correct/incorrect) answers at all — e.g. every question is still `needs-review` or was `excluded`. */
  correctPercent: number | null;
}

export interface ScoreDistributionBucket {
  /** Inclusive. */
  rangeStart: number;
  /** Exclusive, except the last bucket (90–100), which includes 100 itself. */
  rangeEnd: number;
  studentCount: number;
}

export interface ClassAnalytics {
  /** Every question, hardest (lowest `correctPercent`) first. A `null`-percent question (no known answers from anyone) sorts last — there's no difficulty data to rank it by. */
  hardestQuestions: QuestionBreakdown[];
  /** Every student, weakest (lowest `correctPercent`) first. A `null`-percent student sorts last, same reasoning. */
  weakestStudents: WeakestStudent[];
  /** Ten fixed 10-point buckets covering 0–100, in order. Excludes students with a `null` `correctPercent` — see `unscoredStudentCount`. */
  scoreDistribution: ScoreDistributionBucket[];
  /** Students excluded from `scoreDistribution` because they have no known answers yet (everything `needs-review`/`excluded`) — surfaced rather than silently dropped. */
  unscoredStudentCount: number;
}

const DISTRIBUTION_BUCKET_WIDTH = 10;
const DISTRIBUTION_BUCKET_COUNT = 100 / DISTRIBUTION_BUCKET_WIDTH;

/** `null` sorts after every real percentage, regardless of which end "worst" is on for a given list. */
function rankValue(percent: number | null): number {
  return percent === null ? Infinity : percent;
}

function byAscendingPercent(
  a: { correctPercent: number | null },
  b: { correctPercent: number | null },
): number {
  return rankValue(a.correctPercent) - rankValue(b.correctPercent);
}

export function computeClassAnalytics(
  students: readonly StudentResult[],
  questionCount: number,
): ClassAnalytics {
  const hardestQuestions = [...computeQuestionBreakdown(students, questionCount)].sort(
    byAscendingPercent,
  );

  const weakestStudents: WeakestStudent[] = students
    .map((student) => {
      const { correctCount, incorrectCount } = student.scored;
      const knownCount = correctCount + incorrectCount;
      return {
        id: student.id,
        rollNumber: student.rollNumber,
        name: student.name,
        correctCount,
        knownCount,
        correctPercent: knownCount === 0 ? null : (correctCount / knownCount) * 100,
      };
    })
    .sort(byAscendingPercent);

  const scoreDistribution: ScoreDistributionBucket[] = Array.from(
    { length: DISTRIBUTION_BUCKET_COUNT },
    (_, i) => ({
      rangeStart: i * DISTRIBUTION_BUCKET_WIDTH,
      rangeEnd: (i + 1) * DISTRIBUTION_BUCKET_WIDTH,
      studentCount: 0,
    }),
  );

  let unscoredStudentCount = 0;
  for (const student of weakestStudents) {
    if (student.correctPercent === null) {
      unscoredStudentCount++;
      continue;
    }
    const bucketIndex = Math.min(
      Math.floor(student.correctPercent / DISTRIBUTION_BUCKET_WIDTH),
      scoreDistribution.length - 1,
    );
    scoreDistribution[bucketIndex]!.studentCount++;
  }

  return { hardestQuestions, weakestStudents, scoreDistribution, unscoredStudentCount };
}

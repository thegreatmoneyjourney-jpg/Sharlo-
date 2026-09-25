/**
 * Scores a student's classified answers against a captured answer key
 * (FR-EXAM-03: "every subsequent student-sheet scan scores immediately
 * against the captured key").
 *
 * Both `studentResult` and `keyResult` come from the exact same
 * `readAnswerSheet` pipeline — an answer key is just the first sheet
 * scanned for an exam, per FR-EXAM-03's own wording, not a differently-
 * shaped record. Scoring never guesses from an ambiguous input on
 * either side: a `flagged`/multi-mark student answer, or a key entry
 * that was never cleanly resolved to a single confident mark, both
 * route to `needs-review` rather than being silently scored as correct
 * or incorrect — the same "flag, don't guess" principle `bubble-fill.ts`
 * enforces at the single-bubble layer, applied here at the scoring
 * layer. In practice a key should never reach this function with an
 * unresolved entry (M2-004's key-capture flow requires every question
 * to be cleanly `answered` before accepting a key — see
 * `app/(app)/exams/new/exam-scan-flow.tsx`), but this function stays
 * defensive regardless of what a caller actually enforced upstream.
 */

import type { QuestionResult } from './bubble-fill';

export type QuestionScore =
  | { outcome: 'correct' }
  | { outcome: 'incorrect' }
  | { outcome: 'needs-review' }
  | { outcome: 'excluded' };

export function scoreQuestion(
  studentResult: QuestionResult,
  keyResult: QuestionResult,
): QuestionScore {
  if (keyResult.outcome !== 'answered') return { outcome: 'needs-review' };
  if (studentResult.outcome === 'flagged') return { outcome: 'needs-review' };
  if (studentResult.outcome === 'blank') return { outcome: 'incorrect' };
  return studentResult.optionIndex === keyResult.optionIndex
    ? { outcome: 'correct' }
    : { outcome: 'incorrect' };
}

export interface ScoredSheet {
  /** Same order/length as the input arrays. */
  scores: QuestionScore[];
  correctCount: number;
  incorrectCount: number;
  needsReviewCount: number;
  /** Manually excluded via review-queue resolution (M2-006) — never produced by scoreQuestion itself, only by applyReviewResolution. Not counted toward either correctCount or incorrectCount, and callers displaying a "X / Y" tally should subtract this from Y — an excluded question was never a fair test of that student. */
  excludedCount: number;
}

function tally(scores: readonly QuestionScore[]): Omit<ScoredSheet, 'scores'> {
  return {
    correctCount: scores.filter((s) => s.outcome === 'correct').length,
    incorrectCount: scores.filter((s) => s.outcome === 'incorrect').length,
    needsReviewCount: scores.filter((s) => s.outcome === 'needs-review').length,
    excludedCount: scores.filter((s) => s.outcome === 'excluded').length,
  };
}

/** Throws on a length mismatch rather than silently scoring against the wrong question — student/key results must come from the same template's geometry. */
export function scoreSheet(
  studentResults: readonly QuestionResult[],
  keyResults: readonly QuestionResult[],
): ScoredSheet {
  if (studentResults.length !== keyResults.length) {
    throw new Error(
      `scoreSheet: student (${studentResults.length}) and key (${keyResults.length}) question counts don't match`,
    );
  }

  const scores = studentResults.map((student, i) => scoreQuestion(student, keyResults[i]!));
  return { scores, ...tally(scores) };
}

/** Recomputes a ScoredSheet's aggregate counts from a (possibly manually-edited) scores array — same tally scoreSheet itself uses, so a caller that mutates one entry via applyReviewResolution never hand-rolls its own counting logic. */
export function rescoreSheet(scores: readonly QuestionScore[]): ScoredSheet {
  return { scores: [...scores], ...tally(scores) };
}

export type QuestionResolution =
  { action: 'pick'; optionIndex: number } | { action: 'mark-blank' } | { action: 'exclude' };

/**
 * Applies a teacher's manual review-queue decision (FR-REVIEW-02: "picking
 * the correct answer... or marking 'left blank' / 'invalid, exclude from
 * scoring'") to a single flagged question. `keyResult` must be the same
 * `answered` key entry `scoreQuestion` was already given for this question
 * — M2-004's key-capture flow refuses to accept a key with any unresolved
 * question, so the defensive `needs-review` fallback below should be
 * unreachable in practice, the same guarantee `scoreQuestion` itself
 * documents.
 */
export function applyReviewResolution(
  resolution: QuestionResolution,
  keyResult: QuestionResult,
): QuestionScore {
  if (resolution.action === 'exclude') return { outcome: 'excluded' };
  if (keyResult.outcome !== 'answered') return { outcome: 'needs-review' };
  if (resolution.action === 'mark-blank') return { outcome: 'incorrect' };
  return resolution.optionIndex === keyResult.optionIndex
    ? { outcome: 'correct' }
    : { outcome: 'incorrect' };
}

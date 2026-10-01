import { rescoreSheet } from '../scanning/score-answers';
import type { QuestionScore } from '../scanning/score-answers';
import type { StudentResult } from './exam-results';

/**
 * `M3-008`/`FR-IMPORT-06` — the pure, framework-free data operations
 * behind the reusable editable-results-grid component. Kept separate
 * from the component itself (matching this codebase's existing split,
 * e.g. `lib/scanning/review-queue.ts` vs `review-queue-panel.tsx`) so
 * every edit is independently, directly unit-testable without mounting
 * a DOM.
 */

export function updateStudentName(
  students: readonly StudentResult[],
  studentId: number,
  name: string,
): StudentResult[] {
  return students.map((s) =>
    s.id === studentId ? { ...s, name: name.trim().length > 0 ? name : null } : s,
  );
}

export function updateStudentRollNumber(
  students: readonly StudentResult[],
  studentId: number,
  rollNumber: string,
): StudentResult[] {
  return students.map((s) =>
    s.id === studentId ? { ...s, rollNumber: rollNumber.trim().length > 0 ? rollNumber : null } : s,
  );
}

/** Changes one question's score outcome and re-tallies that student's `scored` from the full (possibly-edited) scores array — never hand-adjusts `correctCount`/etc. directly, the same discipline `rescoreSheet`'s own existing callers (review-queue resolution) already follow. */
export function updateQuestionScore(
  students: readonly StudentResult[],
  studentId: number,
  questionIndex: number,
  outcome: QuestionScore['outcome'],
): StudentResult[] {
  return students.map((s) => {
    if (s.id !== studentId) return s;
    const scores = [...s.scored.scores];
    scores[questionIndex] = { outcome };
    return { ...s, scored: rescoreSheet(scores) };
  });
}

/**
 * Appends a new, blank student row. Every question starts as
 * `needs-review` — not a real scan outcome here, but the same "excluded
 * from a known-answer tally until resolved" semantic `computeQuestionBreakdown`
 * already gives that outcome, which is exactly what an unentered mark is:
 * unknown, not a guessed zero.
 */
export function addBlankStudent(
  students: readonly StudentResult[],
  questionCount: number,
): StudentResult[] {
  const id = Date.now() + students.length;
  const scores: QuestionScore[] = Array.from({ length: questionCount }, () => ({
    outcome: 'needs-review',
  }));
  const newStudent: StudentResult = {
    id,
    rollNumber: null,
    name: null,
    scored: rescoreSheet(scores),
  };
  return [...students, newStudent];
}

export function removeStudent(
  students: readonly StudentResult[],
  studentId: number,
): StudentResult[] {
  return students.filter((s) => s.id !== studentId);
}

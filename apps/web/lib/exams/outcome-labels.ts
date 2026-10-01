import type { QuestionScore } from '../scanning/score-answers';

/**
 * The one shared label map for a per-question outcome — used by the
 * editable grid (`app/(app)/results-grid.tsx`, `M3-008`) and the
 * CSV/Excel export (`lib/export/exam-export.ts`, `M3-010`) so a teacher
 * sees the exact same wording on screen and in an exported file.
 */
export const OUTCOME_LABELS: Record<QuestionScore['outcome'], string> = {
  correct: 'Correct',
  incorrect: 'Incorrect',
  'needs-review': 'Needs review',
  excluded: 'Excluded',
};

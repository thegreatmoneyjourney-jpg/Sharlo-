import type { QuestionResult } from '@/lib/scanning/bubble-fill';
import { scoreSheet } from '@/lib/scanning/score-answers';
import type { ScoredSheet } from '@/lib/scanning/score-answers';
import type { SheetReadOutcome } from '@/lib/scanning/read-sheet-from-image';
import type { TemplateGeometry } from '@/lib/templates/geometry';
import type { ReviewQueueItem } from './review-queue-panel';

/** One scanned student sheet, accumulated across the whole scan-students session (M2-006) — `scored` is re-derived via `rescoreSheet` whenever a review-queue item for this student is resolved, never hand-edited in place. */
export interface StudentResult {
  id: number;
  rollNumber: string | null;
  scored: ScoredSheet;
}

/**
 * M2-008 (FR-DETECT-05): a freshly-read capture whose roll number matches
 * an already-saved student, held here rather than added straight to
 * `students`/`reviewQueue` — "warn... before it's saved" means exactly
 * that: nothing about this capture is committed until the teacher
 * explicitly confirms or cancels it.
 */
export interface PendingDuplicate {
  rollNumber: string;
  newStudent: StudentResult;
  newQueueItems: ReviewQueueItem[];
}

export type Mode =
  | { phase: 'capture-key'; error?: string }
  | {
      phase: 'scan-students';
      key: QuestionResult[];
      students: StudentResult[];
      reviewQueue: ReviewQueueItem[];
      showReviewQueue: boolean;
      pendingDuplicate: PendingDuplicate | null;
    };

/**
 * The single decision point for "a new sheet was just read — what
 * happens to `Mode` as a result?" (key acceptance/rejection, scoring a
 * student sheet, the M2-008 duplicate-roll-number gate). Pure and
 * React/timer-free — `studentId`/`addedAt` are passed in rather than
 * read from `capturedAt`/`Date.now()` internally, so this stays a
 * function of its explicit inputs only, directly unit-testable without
 * mocking time or a live capture.
 *
 * This is the exact function both `exam-scan-flow.tsx`'s live-capture
 * effect and M2-009's batch-import loop call — "the same review-queue/
 * scoring path as live scans" (M2-009's own done-when wording) means
 * literally the same function, not a parallel implementation of the
 * same rules that could quietly drift from it.
 */
export function applyReadResult(
  prev: Mode,
  input: {
    readResult: SheetReadOutcome;
    studentId: number;
    addedAt: number;
    geometry: TemplateGeometry;
  },
): Mode {
  const { readResult, studentId, addedAt, geometry } = input;

  if (prev.phase === 'capture-key') {
    const unresolved = readResult.result.questions
      .map((q, i) => (q.outcome === 'answered' ? null : i + 1))
      .filter((n): n is number => n !== null);
    if (unresolved.length === 0) {
      return {
        phase: 'scan-students',
        key: readResult.result.questions,
        students: [],
        reviewQueue: [],
        showReviewQueue: false,
        pendingDuplicate: null,
      };
    }
    return {
      phase: 'capture-key',
      error: `Question${unresolved.length > 1 ? 's' : ''} ${unresolved.join(', ')} ${unresolved.length > 1 ? "weren't" : "wasn't"} clearly marked on the key sheet — hold it steady and scan again.`,
    };
  }

  // A decision on a previous capture is still pending — ignore further
  // reads rather than letting a new one silently interfere with (or get
  // lost behind) the one the teacher hasn't resolved yet. In batch
  // import this is exactly how processing pauses at a duplicate: the
  // caller stops advancing its queue the moment this returns `prev`
  // unchanged, and resumes once `pendingDuplicate` clears.
  if (prev.pendingDuplicate) return prev;

  const rollNumber = readResult.rollRead.status === 'read' ? readResult.rollRead.value : null;
  const scored = scoreSheet(readResult.result.questions, prev.key);
  const newStudent: StudentResult = { id: studentId, rollNumber, scored };

  const newQueueItems: ReviewQueueItem[] = readResult.reviewCrops.map((crop) =>
    crop.kind === 'question'
      ? {
          id: `${studentId}-q${crop.questionNumber}`,
          studentId,
          addedAt,
          cropDataUrl: crop.cropDataUrl,
          kind: 'question',
          questionNumber: crop.questionNumber,
          optionCount: geometry.questions[crop.questionNumber - 1]?.options.length ?? 0,
        }
      : {
          id: `${studentId}-roll`,
          studentId,
          addedAt,
          cropDataUrl: crop.cropDataUrl,
          kind: 'roll-number',
        },
  );

  // FR-DETECT-05: same roll number already scanned for this exam -> hold
  // the capture for confirmation rather than saving it straight away.
  // Roll-number-only matching, not FR-DETECT-05's own "or a matching
  // visual fingerprint" alternative — see docs/reports/SHARLO-M2-008.md's
  // Flags for why that's out of scope rather than half-built.
  if (rollNumber !== null && prev.students.some((s) => s.rollNumber === rollNumber)) {
    return { ...prev, pendingDuplicate: { rollNumber, newStudent, newQueueItems } };
  }

  return {
    ...prev,
    students: [...prev.students, newStudent],
    reviewQueue: [...prev.reviewQueue, ...newQueueItems],
  };
}

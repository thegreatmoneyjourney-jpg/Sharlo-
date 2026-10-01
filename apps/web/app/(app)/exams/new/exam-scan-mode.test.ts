import { describe, expect, it } from 'vitest';
import { applyReadResult } from './exam-scan-mode';
import type { Mode } from './exam-scan-mode';
import { computeStockTemplateGeometry } from '@/lib/templates/geometry';
import { readRollNumber } from '@/lib/scanning/roll-number';
import { resolveRollNumberAgainstRoster } from '@/lib/roster/roster';
import type { QuestionResult } from '@/lib/scanning/bubble-fill';
import type { SheetReadOutcome } from '@/lib/scanning/read-sheet-from-image';

const GEOMETRY = computeStockTemplateGeometry(20);
const CAPTURE_KEY_MODE: Mode = { phase: 'capture-key' };

function readOutcome(
  questions: QuestionResult[],
  rollNumberColumns: QuestionResult[] = [{ outcome: 'answered', optionIndex: 4 }],
  reviewCrops: SheetReadOutcome['reviewCrops'] = [],
  roster: ReadonlyMap<string, string> | null = null,
): SheetReadOutcome {
  const rollRead = readRollNumber(rollNumberColumns);
  return {
    result: { questions, rollNumberColumns },
    rollRead,
    rollNumberMatch: resolveRollNumberAgainstRoster(rollRead, roster),
    reviewCrops,
  };
}

function allAnswered(count: number, optionIndex = 0): SheetReadOutcome {
  return readOutcome(
    Array.from({ length: count }, () => ({ outcome: 'answered' as const, optionIndex })),
  );
}

describe('applyReadResult — capture-key phase', () => {
  it('accepts a fully-answered key and switches to scan-students with an empty roster', () => {
    const next = applyReadResult(CAPTURE_KEY_MODE, {
      readResult: allAnswered(20),
      studentId: 1,
      addedAt: 1000,
      geometry: GEOMETRY,
    });
    expect(next).toMatchObject({
      phase: 'scan-students',
      students: [],
      reviewQueue: [],
      showReviewQueue: false,
      pendingDuplicate: null,
    });
  });

  it('rejects an incompletely-answered key, naming the unresolved questions', () => {
    const questions: QuestionResult[] = Array.from({ length: 20 }, (_, i) =>
      i === 1 || i === 5 ? { outcome: 'flagged' } : { outcome: 'answered', optionIndex: 0 },
    );
    const next = applyReadResult(CAPTURE_KEY_MODE, {
      readResult: readOutcome(questions),
      studentId: 1,
      addedAt: 1000,
      geometry: GEOMETRY,
    });
    expect(next.phase).toBe('capture-key');
    expect((next as { error?: string }).error).toMatch(/2, 6/);
  });
});

describe('applyReadResult — scan-students phase', () => {
  const key: QuestionResult[] = Array.from({ length: 20 }, () => ({
    outcome: 'answered' as const,
    optionIndex: 0,
  }));
  const baseMode: Mode = {
    phase: 'scan-students',
    key,
    students: [],
    reviewQueue: [],
    showReviewQueue: false,
    pendingDuplicate: null,
  };

  it('scores a clean student capture and adds it to students', () => {
    const studentAnswers: QuestionResult[] = key.map((_, i) => ({
      outcome: 'answered',
      optionIndex: i < 18 ? 0 : 1,
    }));
    const next = applyReadResult(baseMode, {
      readResult: readOutcome(studentAnswers, [{ outcome: 'answered', optionIndex: 7 }]),
      studentId: 100,
      addedAt: 1000,
      geometry: GEOMETRY,
    });
    expect(next.phase).toBe('scan-students');
    if (next.phase !== 'scan-students') throw new Error('unreachable');
    expect(next.students).toHaveLength(1);
    expect(next.students[0]).toMatchObject({ id: 100, rollNumber: '7' });
    expect(next.students[0]!.scored.correctCount).toBe(18);
  });

  it('turns a flagged question into a review-queue item with the correct option count from geometry', () => {
    const studentAnswers: QuestionResult[] = key.map((_, i) =>
      i === 2 ? { outcome: 'flagged' } : { outcome: 'answered', optionIndex: 0 },
    );
    const next = applyReadResult(baseMode, {
      readResult: readOutcome(
        studentAnswers,
        [{ outcome: 'answered', optionIndex: 1 }],
        [{ kind: 'question', questionNumber: 3, cropDataUrl: 'data:image/png;base64,FAKE' }],
      ),
      studentId: 100,
      addedAt: 5000,
      geometry: GEOMETRY,
    });
    if (next.phase !== 'scan-students') throw new Error('unreachable');
    expect(next.reviewQueue).toHaveLength(1);
    expect(next.reviewQueue[0]).toMatchObject({
      kind: 'question',
      questionNumber: 3,
      addedAt: 5000,
      optionCount: GEOMETRY.questions[2]!.options.length,
    });
  });

  it('holds a duplicate roll number as pendingDuplicate instead of saving it', () => {
    const withOneStudent: Mode = {
      ...baseMode,
      students: [
        {
          id: 1,
          rollNumber: '9',
          name: null,
          scored: {
            scores: [],
            correctCount: 0,
            incorrectCount: 0,
            needsReviewCount: 0,
            excludedCount: 0,
          },
        },
      ],
    };
    const next = applyReadResult(withOneStudent, {
      readResult: readOutcome(allAnswered(20).result.questions, [
        { outcome: 'answered', optionIndex: 9 },
      ]),
      studentId: 200,
      addedAt: 6000,
      geometry: GEOMETRY,
    });
    if (next.phase !== 'scan-students') throw new Error('unreachable');
    expect(next.students).toHaveLength(1); // not yet saved
    expect(next.pendingDuplicate).toMatchObject({ rollNumber: '9' });
  });

  it('a different roll number is saved normally, not held as a duplicate', () => {
    const withOneStudent: Mode = {
      ...baseMode,
      students: [
        {
          id: 1,
          rollNumber: '9',
          name: null,
          scored: {
            scores: [],
            correctCount: 0,
            incorrectCount: 0,
            needsReviewCount: 0,
            excludedCount: 0,
          },
        },
      ],
    };
    const next = applyReadResult(withOneStudent, {
      readResult: readOutcome(allAnswered(20).result.questions, [
        { outcome: 'answered', optionIndex: 2 },
      ]),
      studentId: 200,
      addedAt: 6000,
      geometry: GEOMETRY,
    });
    if (next.phase !== 'scan-students') throw new Error('unreachable');
    expect(next.students).toHaveLength(2);
    expect(next.pendingDuplicate).toBeNull();
  });

  it('ignores a new read result while a duplicate decision is still pending — the mechanism M2-009 batch import relies on to pause', () => {
    const withPending: Mode = {
      ...baseMode,
      pendingDuplicate: {
        rollNumber: '5',
        newStudent: {
          id: 1,
          rollNumber: '5',
          name: null,
          scored: {
            scores: [],
            correctCount: 0,
            incorrectCount: 0,
            needsReviewCount: 0,
            excludedCount: 0,
          },
        },
        newQueueItems: [],
      },
    };
    const next = applyReadResult(withPending, {
      readResult: allAnswered(20),
      studentId: 300,
      addedAt: 7000,
      geometry: GEOMETRY,
    });
    expect(next).toBe(withPending); // unchanged, same reference
  });

  it('an unread roll number never counts as a duplicate, even against another unread capture', () => {
    const withOneStudent: Mode = {
      ...baseMode,
      students: [
        {
          id: 1,
          rollNumber: null,
          name: null,
          scored: {
            scores: [],
            correctCount: 0,
            incorrectCount: 0,
            needsReviewCount: 0,
            excludedCount: 0,
          },
        },
      ],
    };
    const next = applyReadResult(withOneStudent, {
      readResult: readOutcome(allAnswered(20).result.questions, [{ outcome: 'blank' }]),
      studentId: 200,
      addedAt: 6000,
      geometry: GEOMETRY,
    });
    if (next.phase !== 'scan-students') throw new Error('unreachable');
    expect(next.students).toHaveLength(2);
    expect(next.pendingDuplicate).toBeNull();
  });
});

describe('applyReadResult — roster matching (M3-007)', () => {
  const key: QuestionResult[] = Array.from({ length: 20 }, () => ({
    outcome: 'answered' as const,
    optionIndex: 0,
  }));
  const baseMode: Mode = {
    phase: 'scan-students',
    key,
    students: [],
    reviewQueue: [],
    showReviewQueue: false,
    pendingDuplicate: null,
  };

  it('populates the student name when the roll number matches a roster entry', () => {
    const roster = new Map([['4', 'Alice']]);
    const next = applyReadResult(baseMode, {
      readResult: readOutcome(
        allAnswered(20).result.questions,
        [{ outcome: 'answered', optionIndex: 4 }],
        [],
        roster,
      ),
      studentId: 100,
      addedAt: 1000,
      geometry: GEOMETRY,
    });
    if (next.phase !== 'scan-students') throw new Error('unreachable');
    expect(next.students[0]).toMatchObject({ rollNumber: '4', name: 'Alice' });
    expect(next.reviewQueue).toHaveLength(0);
  });

  it('leaves name null and adds a reviewQueue item with reason "unmatched" when the roll number reads cleanly but matches nothing', () => {
    const roster = new Map([['4', 'Alice']]);
    const next = applyReadResult(baseMode, {
      readResult: readOutcome(
        allAnswered(20).result.questions,
        [{ outcome: 'answered', optionIndex: 9 }],
        [{ kind: 'roll-number', cropDataUrl: 'data:image/png;base64,FAKE' }],
        roster,
      ),
      studentId: 100,
      addedAt: 1000,
      geometry: GEOMETRY,
    });
    if (next.phase !== 'scan-students') throw new Error('unreachable');
    expect(next.students[0]).toMatchObject({ rollNumber: '9', name: null });
    expect(next.reviewQueue).toHaveLength(1);
    expect(next.reviewQueue[0]).toMatchObject({
      kind: 'roll-number',
      reason: 'unmatched',
      readValue: '9',
    });
  });

  it('adds a reviewQueue item with reason "unread" and a null readValue when the roll number can\'t be read, even with a roster present', () => {
    const roster = new Map([['4', 'Alice']]);
    const next = applyReadResult(baseMode, {
      readResult: readOutcome(
        allAnswered(20).result.questions,
        [{ outcome: 'blank' }],
        [{ kind: 'roll-number', cropDataUrl: 'data:image/png;base64,FAKE' }],
        roster,
      ),
      studentId: 100,
      addedAt: 1000,
      geometry: GEOMETRY,
    });
    if (next.phase !== 'scan-students') throw new Error('unreachable');
    expect(next.students[0]).toMatchObject({ rollNumber: null, name: null });
    expect(next.reviewQueue[0]).toMatchObject({
      kind: 'roll-number',
      reason: 'unread',
      readValue: null,
    });
  });

  it('leaves name null, with no review item, when no roster is selected at all — pre-M3-007 behavior preserved', () => {
    const next = applyReadResult(baseMode, {
      readResult: readOutcome(allAnswered(20).result.questions, [
        { outcome: 'answered', optionIndex: 4 },
      ]),
      studentId: 100,
      addedAt: 1000,
      geometry: GEOMETRY,
    });
    if (next.phase !== 'scan-students') throw new Error('unreachable');
    expect(next.students[0]).toMatchObject({ rollNumber: '4', name: null });
    expect(next.reviewQueue).toHaveLength(0);
  });
});

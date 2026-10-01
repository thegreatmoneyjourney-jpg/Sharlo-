import { describe, expect, it } from 'vitest';
import {
  addBlankStudent,
  removeStudent,
  updateQuestionScore,
  updateStudentName,
  updateStudentRollNumber,
} from './results-grid-ops';
import type { StudentResult } from './exam-results';

function makeStudent(overrides: Partial<StudentResult> = {}): StudentResult {
  return {
    id: 1,
    rollNumber: '7',
    name: 'Alice',
    scored: {
      scores: [{ outcome: 'correct' }, { outcome: 'incorrect' }],
      correctCount: 1,
      incorrectCount: 1,
      needsReviewCount: 0,
      excludedCount: 0,
    },
    ...overrides,
  };
}

describe('updateStudentName', () => {
  it('updates only the matching student', () => {
    const students = [makeStudent({ id: 1 }), makeStudent({ id: 2, name: 'Bob' })];
    const result = updateStudentName(students, 1, 'Alicia');
    expect(result[0]!.name).toBe('Alicia');
    expect(result[1]!.name).toBe('Bob');
  });

  it('stores an empty name as null, not an empty string', () => {
    const result = updateStudentName([makeStudent()], 1, '   ');
    expect(result[0]!.name).toBeNull();
  });
});

describe('updateStudentRollNumber', () => {
  it('updates only the matching student', () => {
    const students = [makeStudent({ id: 1, rollNumber: '7' })];
    const result = updateStudentRollNumber(students, 1, '42');
    expect(result[0]!.rollNumber).toBe('42');
  });

  it('stores an empty roll number as null', () => {
    const result = updateStudentRollNumber([makeStudent()], 1, '');
    expect(result[0]!.rollNumber).toBeNull();
  });
});

describe('updateQuestionScore', () => {
  it('changes one question and re-tallies the whole scored object', () => {
    const result = updateQuestionScore([makeStudent()], 1, 1, 'correct');
    expect(result[0]!.scored).toEqual({
      scores: [{ outcome: 'correct' }, { outcome: 'correct' }],
      correctCount: 2,
      incorrectCount: 0,
      needsReviewCount: 0,
      excludedCount: 0,
    });
  });

  it('leaves other students untouched', () => {
    const students = [makeStudent({ id: 1 }), makeStudent({ id: 2 })];
    const result = updateQuestionScore(students, 1, 0, 'excluded');
    expect(result[1]!.scored).toEqual(students[1]!.scored);
  });
});

describe('addBlankStudent', () => {
  it('appends a student with every question needs-review and no name/roll number', () => {
    const result = addBlankStudent([makeStudent({ id: 1 })], 3);
    expect(result).toHaveLength(2);
    const added = result[1]!;
    expect(added.name).toBeNull();
    expect(added.rollNumber).toBeNull();
    expect(added.scored.scores).toEqual([
      { outcome: 'needs-review' },
      { outcome: 'needs-review' },
      { outcome: 'needs-review' },
    ]);
    expect(added.scored.needsReviewCount).toBe(3);
  });

  it('mints an id distinct from every existing student', () => {
    const existing = [makeStudent({ id: 1 }), makeStudent({ id: 2 })];
    const result = addBlankStudent(existing, 1);
    const ids = result.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('removeStudent', () => {
  it('removes only the matching student', () => {
    const students = [makeStudent({ id: 1 }), makeStudent({ id: 2 })];
    const result = removeStudent(students, 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(2);
  });

  it('is a no-op when the id does not exist', () => {
    const students = [makeStudent({ id: 1 })];
    expect(removeStudent(students, 999)).toEqual(students);
  });
});

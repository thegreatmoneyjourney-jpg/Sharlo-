import { describe, expect, it } from 'vitest';
import { computeQuestionBreakdown } from './question-breakdown';
import type { StudentResult } from './exam-results';
import type { QuestionScore } from '../scanning/score-answers';

function scored(scores: QuestionScore['outcome'][]): StudentResult['scored'] {
  const questionScores = scores.map((outcome) => ({ outcome })) as QuestionScore[];
  return {
    scores: questionScores,
    correctCount: questionScores.filter((s) => s.outcome === 'correct').length,
    incorrectCount: questionScores.filter((s) => s.outcome === 'incorrect').length,
    needsReviewCount: questionScores.filter((s) => s.outcome === 'needs-review').length,
    excludedCount: questionScores.filter((s) => s.outcome === 'excluded').length,
  };
}

function student(id: number, scores: QuestionScore['outcome'][]): StudentResult {
  return { id, rollNumber: String(id), name: null, scored: scored(scores) };
}

describe('computeQuestionBreakdown', () => {
  it('matches hand-calculated stats for a known fixture', () => {
    // A: Q1 correct,   Q2 incorrect,     Q3 excluded
    // B: Q1 correct,   Q2 correct,       Q3 incorrect
    // C: Q1 incorrect, Q2 needs-review,  Q3 incorrect
    const students = [
      student(1, ['correct', 'incorrect', 'excluded']),
      student(2, ['correct', 'correct', 'incorrect']),
      student(3, ['incorrect', 'needs-review', 'incorrect']),
    ];

    const breakdown = computeQuestionBreakdown(students, 3);

    expect(breakdown).toEqual([
      {
        questionNumber: 1,
        correctCount: 2,
        incorrectCount: 1,
        needsReviewCount: 0,
        excludedCount: 0,
        correctPercent: (2 / 3) * 100,
      },
      {
        questionNumber: 2,
        correctCount: 1,
        incorrectCount: 1,
        needsReviewCount: 1,
        excludedCount: 0,
        correctPercent: 50,
      },
      {
        questionNumber: 3,
        correctCount: 0,
        incorrectCount: 2,
        needsReviewCount: 0,
        excludedCount: 1,
        correctPercent: 0,
      },
    ]);
  });

  it('returns a null percent, not a division-by-zero result, for an empty class', () => {
    const breakdown = computeQuestionBreakdown([], 2);
    expect(breakdown).toEqual([
      {
        questionNumber: 1,
        correctCount: 0,
        incorrectCount: 0,
        needsReviewCount: 0,
        excludedCount: 0,
        correctPercent: null,
      },
      {
        questionNumber: 2,
        correctCount: 0,
        incorrectCount: 0,
        needsReviewCount: 0,
        excludedCount: 0,
        correctPercent: null,
      },
    ]);
  });

  it('returns a null percent when every entry for a question is excluded or needs-review', () => {
    const students = [student(1, ['excluded']), student(2, ['needs-review'])];
    const breakdown = computeQuestionBreakdown(students, 1);
    expect(breakdown[0]!.correctPercent).toBeNull();
  });

  it('skips a student missing an entry for a question rather than throwing', () => {
    const incomplete = student(1, ['correct']); // only 1 entry, but questionCount is 2
    const breakdown = computeQuestionBreakdown([incomplete], 2);
    expect(breakdown[1]).toMatchObject({
      correctCount: 0,
      incorrectCount: 0,
      correctPercent: null,
    });
  });
});

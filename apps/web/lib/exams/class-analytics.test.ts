import { describe, expect, it } from 'vitest';
import { computeClassAnalytics } from './class-analytics';
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

function student(
  id: number,
  scores: QuestionScore['outcome'][],
  name: string | null = null,
): StudentResult {
  return { id, rollNumber: String(id), name, scored: scored(scores) };
}

describe('computeClassAnalytics', () => {
  it('matches hand-calculated stats for a known fixture', () => {
    // A: Q1 correct,   Q2 incorrect,     Q3 excluded     -> 1/2 known correct = 50%
    // B: Q1 correct,   Q2 correct,       Q3 incorrect    -> 2/3 known correct = 66.667%
    // C: Q1 incorrect, Q2 needs-review,  Q3 incorrect    -> 0/2 known correct = 0%
    // D: Q1 needs-review, Q2 needs-review, Q3 needs-review -> no known answers at all
    const students = [
      student(1, ['correct', 'incorrect', 'excluded'], 'Alice'),
      student(2, ['correct', 'correct', 'incorrect'], 'Bob'),
      student(3, ['incorrect', 'needs-review', 'incorrect'], 'Cara'),
      student(4, ['needs-review', 'needs-review', 'needs-review'], 'Dev'),
    ];

    const analytics = computeClassAnalytics(students, 3);

    // Hardest first: Q3 (0% correct) < Q2 (50%) < Q1 (66.667%).
    expect(analytics.hardestQuestions.map((q) => q.questionNumber)).toEqual([3, 2, 1]);
    expect(analytics.hardestQuestions[0]).toMatchObject({ questionNumber: 3, correctPercent: 0 });
    expect(analytics.hardestQuestions[1]).toMatchObject({ questionNumber: 2, correctPercent: 50 });
    expect(analytics.hardestQuestions[2]).toMatchObject({
      questionNumber: 1,
      correctPercent: (2 / 3) * 100,
    });

    // Weakest first: Cara (0%) < Alice (50%) < Bob (66.667%) < Dev (null, no known answers, sorts last).
    expect(analytics.weakestStudents.map((s) => s.name)).toEqual(['Cara', 'Alice', 'Bob', 'Dev']);
    expect(analytics.weakestStudents[0]).toMatchObject({
      id: 3,
      correctCount: 0,
      knownCount: 2,
      correctPercent: 0,
    });
    expect(analytics.weakestStudents[1]).toMatchObject({
      id: 1,
      correctCount: 1,
      knownCount: 2,
      correctPercent: 50,
    });
    expect(analytics.weakestStudents[2]).toMatchObject({
      id: 2,
      correctCount: 2,
      knownCount: 3,
      correctPercent: (2 / 3) * 100,
    });
    expect(analytics.weakestStudents[3]).toMatchObject({
      id: 4,
      knownCount: 0,
      correctPercent: null,
    });

    // Cara (0%) -> bucket [0,10); Alice (50%) -> bucket [50,60); Bob (66.667%) -> bucket [60,70).
    // Dev has no known percent at all, so is counted separately, not in any bucket.
    expect(analytics.scoreDistribution).toHaveLength(10);
    expect(analytics.scoreDistribution[0]).toEqual({
      rangeStart: 0,
      rangeEnd: 10,
      studentCount: 1,
    });
    expect(analytics.scoreDistribution[5]).toEqual({
      rangeStart: 50,
      rangeEnd: 60,
      studentCount: 1,
    });
    expect(analytics.scoreDistribution[6]).toEqual({
      rangeStart: 60,
      rangeEnd: 70,
      studentCount: 1,
    });
    const bucketsWithStudents = analytics.scoreDistribution.filter((b) => b.studentCount > 0);
    expect(bucketsWithStudents).toHaveLength(3);
    expect(analytics.unscoredStudentCount).toBe(1);
  });

  it('puts a perfect score in the last bucket (90-100), not a nonexistent 11th one', () => {
    const analytics = computeClassAnalytics([student(1, ['correct', 'correct'])], 2);
    expect(analytics.weakestStudents[0]!.correctPercent).toBe(100);
    expect(analytics.scoreDistribution[9]).toEqual({
      rangeStart: 90,
      rangeEnd: 100,
      studentCount: 1,
    });
    expect(analytics.scoreDistribution.filter((b) => b.studentCount > 0)).toHaveLength(1);
  });

  it('handles an empty class without dividing by zero', () => {
    const analytics = computeClassAnalytics([], 2);
    expect(analytics.hardestQuestions).toEqual([
      expect.objectContaining({ questionNumber: 1, correctPercent: null }),
      expect.objectContaining({ questionNumber: 2, correctPercent: null }),
    ]);
    expect(analytics.weakestStudents).toEqual([]);
    expect(analytics.scoreDistribution.every((b) => b.studentCount === 0)).toBe(true);
    expect(analytics.unscoredStudentCount).toBe(0);
  });
});

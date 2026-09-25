import { describe, expect, it } from 'vitest';
import { scoreQuestion, scoreSheet } from './score-answers';
import type { QuestionResult } from './bubble-fill';

const answered = (optionIndex: number): QuestionResult => ({ outcome: 'answered', optionIndex });
const blank: QuestionResult = { outcome: 'blank' };
const flagged: QuestionResult = { outcome: 'flagged' };

describe('scoreQuestion', () => {
  it('marks a matching answer correct', () => {
    expect(scoreQuestion(answered(2), answered(2))).toEqual({ outcome: 'correct' });
  });

  it('marks a non-matching answer incorrect', () => {
    expect(scoreQuestion(answered(1), answered(2))).toEqual({ outcome: 'incorrect' });
  });

  it('marks an unanswered (blank) student question incorrect, not needs-review', () => {
    expect(scoreQuestion(blank, answered(2))).toEqual({ outcome: 'incorrect' });
  });

  it('never guesses a score for a flagged (ambiguous/multi-mark) student answer', () => {
    expect(scoreQuestion(flagged, answered(2))).toEqual({ outcome: 'needs-review' });
  });

  it('never guesses a score against an unresolved key entry, even if the student answer looks clean', () => {
    expect(scoreQuestion(answered(0), blank)).toEqual({ outcome: 'needs-review' });
    expect(scoreQuestion(answered(0), flagged)).toEqual({ outcome: 'needs-review' });
  });

  it('needs-review on a flagged student answer takes priority regardless of the key', () => {
    expect(scoreQuestion(flagged, flagged)).toEqual({ outcome: 'needs-review' });
  });
});

describe('scoreSheet', () => {
  it('tallies a mixed sheet correctly', () => {
    const student: QuestionResult[] = [answered(0), answered(1), blank, flagged, answered(3)];
    const key: QuestionResult[] = [
      answered(0), // correct
      answered(2), // incorrect
      answered(1), // incorrect (blank)
      answered(0), // needs-review (student flagged)
      answered(3), // correct
    ];

    const result = scoreSheet(student, key);
    expect(result.scores).toEqual([
      { outcome: 'correct' },
      { outcome: 'incorrect' },
      { outcome: 'incorrect' },
      { outcome: 'needs-review' },
      { outcome: 'correct' },
    ]);
    expect(result.correctCount).toBe(2);
    expect(result.incorrectCount).toBe(2);
    expect(result.needsReviewCount).toBe(1);
  });

  it('throws on a student/key length mismatch rather than silently misaligning questions', () => {
    expect(() => scoreSheet([answered(0)], [answered(0), answered(1)])).toThrow();
  });

  it('a perfect score has zero incorrect and zero needs-review', () => {
    const key: QuestionResult[] = [answered(0), answered(1), answered(2)];
    const result = scoreSheet(key, key);
    expect(result).toMatchObject({ correctCount: 3, incorrectCount: 0, needsReviewCount: 0 });
  });
});

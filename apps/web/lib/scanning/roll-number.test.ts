import { describe, expect, it } from 'vitest';
import { matchRollNumber, readRollNumber } from './roll-number';
import type { QuestionResult } from './bubble-fill';

function answered(digit: number): QuestionResult {
  return { outcome: 'answered', optionIndex: digit };
}
const BLANK: QuestionResult = { outcome: 'blank' };
const FLAGGED: QuestionResult = { outcome: 'flagged' };

describe('readRollNumber', () => {
  it('combines confidently-answered columns into a roll number string, in order', () => {
    expect(readRollNumber([answered(1), answered(2), answered(3)])).toEqual({
      status: 'read',
      value: '123',
    });
  });

  it('preserves a leading digit 0, not dropping it', () => {
    expect(readRollNumber([answered(0), answered(4), answered(5)])).toEqual({
      status: 'read',
      value: '045',
    });
  });

  it('is unreadable if any single column is blank, even if the rest are confidently answered', () => {
    expect(readRollNumber([answered(1), BLANK, answered(3)])).toEqual({ status: 'unreadable' });
  });

  it('is unreadable if any single column is flagged, even if the rest are confidently answered', () => {
    expect(readRollNumber([answered(1), FLAGGED, answered(3)])).toEqual({ status: 'unreadable' });
  });

  it('handles a single-column roll number', () => {
    expect(readRollNumber([answered(7)])).toEqual({ status: 'read', value: '7' });
  });

  it('does not throw on an empty column list', () => {
    expect(readRollNumber([])).toEqual({ status: 'read', value: '' });
  });
});

const ROSTER = new Set(['045', '123', '999']);

describe('matchRollNumber', () => {
  it('matches a read roll number present in the roster', () => {
    expect(matchRollNumber({ status: 'read', value: '123' }, ROSTER)).toEqual({
      status: 'matched',
      rollNumber: '123',
    });
  });

  it('routes an unreadable result to "unread" without consulting the roster', () => {
    expect(matchRollNumber({ status: 'unreadable' }, ROSTER)).toEqual({ status: 'unread' });
  });

  it('routes a read-but-absent roll number to "unmatched", carrying the read value', () => {
    expect(matchRollNumber({ status: 'read', value: '456' }, ROSTER)).toEqual({
      status: 'unmatched',
      rollNumber: '456',
    });
  });

  // FR-DETECT-04's own wording: "never silently discarded." This suite
  // is the enforcement mechanism for that, mirroring bubble-fill.test.ts's
  // "never guesses" suite — every case here must route away from
  // 'matched', never silently succeed or vanish.
  describe('never silently discards — every non-matching case routes to Review Queue', () => {
    const cases: Array<[string, RollNumberReadResultLike]> = [
      ['completely unreadable (a blank column present)', { status: 'unreadable' }],
      ['read but not on the roster', { status: 'read', value: '000' }],
      ['read but empty string (e.g. a zero-column grid)', { status: 'read', value: '' }],
      ['read but only a roster prefix, not a full match', { status: 'read', value: '12' }],
    ];

    it.each(cases)('%s', (_description, read) => {
      const result = matchRollNumber(read, ROSTER);
      expect(result.status).not.toBe('matched');
    });
  });
});

type RollNumberReadResultLike = { status: 'unreadable' } | { status: 'read'; value: string };

import { describe, expect, it } from 'vitest';
import {
  buildRosterLookup,
  normalizeRollNumber,
  parseRosterCsv,
  resolveRollNumberAgainstRoster,
} from './roster';
import type { Roster } from './roster';

describe('parseRosterCsv', () => {
  it('parses a header-less CSV of roll number, name', () => {
    const result = parseRosterCsv('1,Alice\n2,Bob');
    expect(result.entries).toEqual([
      { rollNumber: '1', studentName: 'Alice' },
      { rollNumber: '2', studentName: 'Bob' },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.skippedHeaderRow).toBeNull();
  });

  it('detects and skips a header row', () => {
    const result = parseRosterCsv('Roll Number,Name\n1,Alice');
    expect(result.entries).toEqual([{ rollNumber: '1', studentName: 'Alice' }]);
    expect(result.skippedHeaderRow).toEqual(['Roll Number', 'Name']);
  });

  it('flags a non-numeric roll number and skips only that row', () => {
    const result = parseRosterCsv('1,Alice\nA7,Bob\n2,Carol');
    expect(result.entries).toEqual([
      { rollNumber: '1', studentName: 'Alice' },
      { rollNumber: '2', studentName: 'Carol' },
    ]);
    expect(result.errors).toEqual([
      { row: 2, reason: '"A7" isn\'t a valid roll number (digits only).' },
    ]);
  });

  it('flags a row with a missing student name', () => {
    const result = parseRosterCsv('1,Alice\n2,');
    expect(result.entries).toEqual([{ rollNumber: '1', studentName: 'Alice' }]);
    expect(result.errors).toEqual([{ row: 2, reason: 'Roll number 2 has no student name.' }]);
  });

  it('flags a duplicate roll number (by normalized identity)', () => {
    const result = parseRosterCsv('7,Alice\n007,Bob');
    expect(result.entries).toEqual([{ rollNumber: '7', studentName: 'Alice' }]);
    expect(result.errors).toEqual([{ row: 2, reason: 'Roll number 007 appears more than once.' }]);
  });

  it('skips a stray blank data row without an error', () => {
    const result = parseRosterCsv('1,Alice\n,\n2,Bob');
    expect(result.entries).toEqual([
      { rollNumber: '1', studentName: 'Alice' },
      { rollNumber: '2', studentName: 'Bob' },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseRosterCsv('')).toEqual({ entries: [], errors: [], skippedHeaderRow: null });
  });
});

describe('normalizeRollNumber', () => {
  it('strips leading zeros', () => {
    expect(normalizeRollNumber('007')).toBe('7');
    expect(normalizeRollNumber('7')).toBe('7');
  });

  it('keeps a single zero as-is', () => {
    expect(normalizeRollNumber('000')).toBe('0');
  });

  it('trims whitespace', () => {
    expect(normalizeRollNumber(' 12 ')).toBe('12');
  });
});

describe('buildRosterLookup', () => {
  it('keys entries by normalized roll number', () => {
    const roster: Roster = {
      recordId: 'r1',
      className: 'Grade 8A',
      entries: [{ rollNumber: '007', studentName: 'Alice' }],
    };
    const lookup = buildRosterLookup(roster);
    expect(lookup.get('7')).toBe('Alice');
    expect(lookup.has('007')).toBe(false);
  });
});

describe('resolveRollNumberAgainstRoster', () => {
  it('passes a successfully-read roll number through unchanged when there is no roster', () => {
    expect(resolveRollNumberAgainstRoster({ status: 'read', value: '007' }, null)).toEqual({
      needsReview: false,
      studentName: null,
    });
  });

  it('still routes an unreadable roll number to review when there is no roster', () => {
    expect(resolveRollNumberAgainstRoster({ status: 'unreadable' }, null)).toEqual({
      needsReview: true,
      reason: 'unread',
    });
  });

  it('matches a scanned value against a differently-zero-padded roster entry', () => {
    const lookup = new Map([['7', 'Alice']]);
    expect(resolveRollNumberAgainstRoster({ status: 'read', value: '007' }, lookup)).toEqual({
      needsReview: false,
      studentName: 'Alice',
    });
  });

  it('routes a read-but-unmatched roll number to review with reason "unmatched"', () => {
    const lookup = new Map([['7', 'Alice']]);
    expect(resolveRollNumberAgainstRoster({ status: 'read', value: '099' }, lookup)).toEqual({
      needsReview: true,
      reason: 'unmatched',
    });
  });

  it('routes an unreadable roll number to review with reason "unread" even with a roster present', () => {
    const lookup = new Map([['7', 'Alice']]);
    expect(resolveRollNumberAgainstRoster({ status: 'unreadable' }, lookup)).toEqual({
      needsReview: true,
      reason: 'unread',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { parseCsv } from './parse-csv';

describe('parseCsv', () => {
  it('splits simple comma-separated rows', () => {
    expect(parseCsv('1,Alice\n2,Bob')).toEqual([
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('1,Alice\r\n2,Bob\r\n')).toEqual([
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
  });

  it('strips a leading UTF-8 BOM', () => {
    expect(parseCsv('﻿1,Alice')).toEqual([['1', 'Alice']]);
  });

  it('handles a quoted field containing a comma', () => {
    expect(parseCsv('1,"Doe, Jane"')).toEqual([['1', 'Doe, Jane']]);
  });

  it('handles a quoted field containing an escaped quote', () => {
    expect(parseCsv('1,"Jane ""JJ"" Doe"')).toEqual([['1', 'Jane "JJ" Doe']]);
  });

  it('handles a quoted field containing a newline', () => {
    expect(parseCsv('1,"multi\nline"\n2,plain')).toEqual([
      ['1', 'multi\nline'],
      ['2', 'plain'],
    ]);
  });

  it('skips blank lines anywhere in the file, not just trailing', () => {
    expect(parseCsv('1,Alice\n\n2,Bob\n\n')).toEqual([
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles a file with no trailing newline', () => {
    expect(parseCsv('1,Alice')).toEqual([['1', 'Alice']]);
  });

  it('produces an empty trailing field after a trailing comma', () => {
    expect(parseCsv('1,Alice,')).toEqual([['1', 'Alice', '']]);
  });
});

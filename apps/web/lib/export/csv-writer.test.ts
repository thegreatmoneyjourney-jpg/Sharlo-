import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv-writer';
import { parseCsv } from '../roster/parse-csv';

describe('buildCsv', () => {
  it('joins headers and rows with commas and CRLF line endings', () => {
    const csv = buildCsv(
      ['Name', 'Score'],
      [
        [
          { type: 'string', value: 'Alice' },
          { type: 'number', value: 7 },
        ],
      ],
    );
    expect(csv).toBe('Name,Score\r\nAlice,7');
  });

  it('sanitizes a string cell starting with a formula-injection character, never a number cell', () => {
    const csv = buildCsv(
      ['Name', 'Score'],
      [
        [
          { type: 'string', value: '=1+1' },
          { type: 'number', value: -1 },
        ],
      ],
    );
    expect(csv).toContain("'=1+1");
    expect(csv).toContain(',-1');
  });

  it('quotes a field containing a comma, quote, or newline, doubling embedded quotes', () => {
    const csv = buildCsv(
      ['Name'],
      [[{ type: 'string', value: 'Doe, Jane "JJ"' }], [{ type: 'string', value: 'line1\nline2' }]],
    );
    const [, ...rows] = csv.split('\r\n');
    expect(rows[0]).toBe('"Doe, Jane ""JJ"""');
    expect(rows[1]).toBe('"line1\nline2"');
  });

  it('round-trips through parseCsv back to the original sanitized values', () => {
    const csv = buildCsv(
      ['Name', 'Roll number', 'Score'],
      [
        [
          { type: 'string', value: 'O, Brien' },
          { type: 'string', value: '007' },
          { type: 'number', value: 10 },
        ],
        [
          { type: 'string', value: '=cmd' },
          { type: 'string', value: '12' },
          { type: 'number', value: 3 },
        ],
      ],
    );
    const parsed = parseCsv(csv);
    expect(parsed).toEqual([
      ['Name', 'Roll number', 'Score'],
      ['O, Brien', '007', '10'],
      ["'=cmd", '12', '3'],
    ]);
  });
});

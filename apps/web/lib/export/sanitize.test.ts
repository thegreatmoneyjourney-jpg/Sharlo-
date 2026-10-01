import { describe, expect, it } from 'vitest';
import { sanitizeCellValue } from './sanitize';

describe('sanitizeCellValue', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)'])(
    'prefixes a value starting with a formula-injection character (%s)',
    (value) => {
      expect(sanitizeCellValue(value)).toBe(`'${value}`);
    },
  );

  it.each(['Alice', '007', '', 'A-1', "O'Brien"])(
    'leaves an ordinary value unchanged (%s)',
    (value) => {
      expect(sanitizeCellValue(value)).toBe(value);
    },
  );

  it('is idempotent -- re-sanitizing an already-prefixed value does not double-prefix it', () => {
    const once = sanitizeCellValue('=1+1');
    expect(sanitizeCellValue(once)).toBe(once);
  });
});

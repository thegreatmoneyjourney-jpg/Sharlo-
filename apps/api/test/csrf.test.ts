import { describe, expect, it } from 'vitest';
import { csrfTokensMatch } from '../src/auth/csrf.js';

describe('csrfTokensMatch', () => {
  it('matches two identical tokens', () => {
    expect(csrfTokensMatch('placeholder-token-value', 'placeholder-token-value')).toBe(true);
  });

  it('rejects a mismatched token', () => {
    expect(csrfTokensMatch('placeholder-token-value', 'a-different-value')).toBe(false);
  });

  it('rejects a missing (undefined) token', () => {
    expect(csrfTokensMatch('placeholder-token-value', undefined)).toBe(false);
  });

  it('rejects a missing (null) token', () => {
    expect(csrfTokensMatch('placeholder-token-value', null)).toBe(false);
  });

  it('rejects an empty-string token', () => {
    expect(csrfTokensMatch('placeholder-token-value', '')).toBe(false);
  });

  it('does not throw on a different-length mismatch (timingSafeEqual would otherwise)', () => {
    expect(() => csrfTokensMatch('short', 'a-much-longer-value-here')).not.toThrow();
    expect(csrfTokensMatch('short', 'a-much-longer-value-here')).toBe(false);
  });
});

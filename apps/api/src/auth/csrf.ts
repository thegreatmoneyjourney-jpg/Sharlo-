import { timingSafeEqual } from 'node:crypto';

/**
 * `ARCHITECTURE.md` §9's double-submit check: the session's CSRF token
 * (known only server-side + in a non-httpOnly cookie the client echoes
 * back as a header) must match exactly. Constant-time comparison so the
 * check itself can't leak how many leading characters matched via timing.
 */
export function csrfTokensMatch(expected: string, actual: string | undefined | null): boolean {
  if (!actual) {
    return false;
  }
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) {
    return false; // timingSafeEqual throws on a length mismatch rather than returning false
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPECTED_SCOPE, extractActualScope } from './check-oauth-scope.mjs';

describe('check-oauth-scope', () => {
  it('extracts the scope string from a GOOGLE_OAUTH_SCOPE declaration', () => {
    const source = `export const GOOGLE_OAUTH_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.file';`;
    expect(extractActualScope(source)).toBe(EXPECTED_SCOPE);
  });

  it('returns null when no such declaration is present', () => {
    expect(extractActualScope('export const SOMETHING_ELSE = 1;')).toBeNull();
  });

  it('detects a widened scope as not matching EXPECTED_SCOPE', () => {
    const widened = `export const GOOGLE_OAUTH_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive';`;
    const actual = extractActualScope(widened);
    expect(actual).not.toBeNull();
    expect(actual).not.toBe(EXPECTED_SCOPE);
  });

  it("matches the real, currently-committed google-oauth.ts's declared scope (the guard this script exists to run in CI)", () => {
    const realSource = readFileSync(
      new URL('../src/auth/google-oauth.ts', import.meta.url),
      'utf8',
    );
    expect(extractActualScope(realSource)).toBe(EXPECTED_SCOPE);
  });
});

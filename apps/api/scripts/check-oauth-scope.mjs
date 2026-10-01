#!/usr/bin/env node
// M3-011 (NFR-SEC-03, "Google Drive scope is drive.file only — CI should
// enforce this, do not weaken that check"): a dedicated, standalone guard
// against this exact non-negotiable, independent of the regular test
// suite -- so widening the scope and quietly editing/removing
// test/google-oauth.test.ts's own assertion in the same PR still can't
// pass CI silently. Deliberately a plain Node script with no app
// dependencies, run as its own named CI job (like gitleaks), not folded
// into "Lint, typecheck, test" where a scope change could get lost among
// many other assertions.
//
// `extractActualScope`/`EXPECTED_SCOPE` are exported so
// `check-oauth-scope.test.ts` can test the comparison logic directly
// against synthetic source text, without needing to spawn this file as a
// subprocess or temporarily mutate the real google-oauth.ts on disk.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EXPECTED_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.file';

/** Returns the quoted value of `GOOGLE_OAUTH_SCOPE`'s declaration in `sourceText`, or `null` if no such declaration is found. */
export function extractActualScope(sourceText) {
  const match = sourceText.match(/export const GOOGLE_OAUTH_SCOPE = '([^']*)';/);
  return match ? match[1] : null;
}

function main() {
  const sourcePath = fileURLToPath(new URL('../src/auth/google-oauth.ts', import.meta.url));
  const actualScope = extractActualScope(readFileSync(sourcePath, 'utf8'));

  if (actualScope === null) {
    console.error(
      `OAuth scope guard: couldn't find a "export const GOOGLE_OAUTH_SCOPE = '...';" declaration in ${sourcePath}. ` +
        'If this file was refactored, update this script to match its new shape -- do not delete the guard.',
    );
    process.exit(1);
  }

  if (actualScope !== EXPECTED_SCOPE) {
    console.error(
      'OAuth scope guard FAILED: the requested Google OAuth scope has changed.\n' +
        `  expected: ${EXPECTED_SCOPE}\n` +
        `  actual:   ${actualScope}\n` +
        "Per NFR-SEC-03 / ARCHITECTURE.md §9 / CLAUDE.md's non-negotiables, this app must request " +
        'drive.file (never a broader Drive scope). If this change is real and reviewed, update ' +
        'EXPECTED_SCOPE in apps/api/scripts/check-oauth-scope.mjs in the same PR, with an explicit ' +
        "reason in the PR description -- don't silently widen access.",
    );
    process.exit(1);
  }

  console.log(
    'OAuth scope guard passed: scope is exactly the expected openid/email/profile/drive.file set.',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

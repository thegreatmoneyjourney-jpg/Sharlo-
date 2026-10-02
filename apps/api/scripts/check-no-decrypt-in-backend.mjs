#!/usr/bin/env node
// `M3-017`/`FR-SCHOOL-04` ("our backend is never in the decrypt path —
// verified the same way as FR-ADMIN-11/M5-011's own structural check"):
// the backend must never gain the *capability* to open a sealed school-
// result copy, unwrap the admin's X25519 private key, or decrypt any
// other student data — this is CLAUDE.md's "no plaintext student data on
// our servers... ever" non-negotiable, applied to this feature. A
// dedicated, standalone guard, independent of the regular test suite —
// same reasoning `check-oauth-scope.mjs` (M3-011) already established —
// so a PR that adds the capability and also quietly edits/removes a
// regular vitest assertion in the same diff still can't pass CI silently.
//
// The check: `libsodium-wrappers-sumo` (and its non-Argon2id sibling
// `libsodium-wrappers`) is the *only* library anywhere in this monorepo
// capable of the X25519 sealed-box operations (`crypto_box_seal`/
// `crypto_box_seal_open`) that decrypt a school-result copy — it's never
// a dependency of `apps/api` (only `apps/web`, which is where every
// school-plan crypto operation actually happens). If it's never even an
// installed dependency, the backend cannot call it, full stop — a much
// stronger guarantee than grepping for today's specific function names,
// which a rewrite could rename around.
//
// `FORBIDDEN_PACKAGES`/`findForbiddenDependencies` are exported so
// `check-no-decrypt-in-backend.test.ts` can test the comparison logic
// directly against synthetic package.json-shaped objects.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_PACKAGES = ['libsodium-wrappers-sumo', 'libsodium-wrappers'];

/** Returns every forbidden package name present in `pkg`'s `dependencies` or `devDependencies`. */
export function findForbiddenDependencies(pkg) {
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  return FORBIDDEN_PACKAGES.filter((name) => name in declared);
}

function main() {
  const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const found = findForbiddenDependencies(pkg);

  if (found.length > 0) {
    console.error(
      'Backend decrypt-capability guard FAILED: apps/api now depends on ' +
        `${found.join(', ')}.\n` +
        'Per CLAUDE.md\'s "no plaintext student data on our servers... ever" non-negotiable ' +
        '(ARCHITECTURE.md §4/§7/§11), our backend must never gain the capability to open a sealed ' +
        'school-result copy or any other student-data ciphertext -- every such operation belongs in ' +
        'apps/web only. If this dependency is genuinely needed server-side for an unrelated, ' +
        'non-decrypting reason, say so explicitly in the PR description and update FORBIDDEN_PACKAGES ' +
        "in apps/api/scripts/check-no-decrypt-in-backend.mjs in the same PR -- don't silently add it.",
    );
    process.exit(1);
  }

  console.log(
    'Backend decrypt-capability guard passed: apps/api has no dependency capable of opening ' +
      'sealed/encrypted student data.',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

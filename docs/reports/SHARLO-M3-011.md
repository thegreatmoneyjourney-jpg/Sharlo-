# SHARLO-M3-011 — OAuth scope CI guard

**Status: done.** Builds `NFR-SEC-03` into a standing CI check, on top of the `GOOGLE_OAUTH_SCOPE` constant and its first (`M3-001`) test-level assertion.

## Flags

None. This task was small, well-scoped, and explicitly named in `CLAUDE.md`'s own non-negotiables ("Google Drive scope is `drive.file` only... CI should enforce this (task M3-011) — do not weaken that check"), with no ambiguity to resolve.

## What was built

- **`apps/api/scripts/check-oauth-scope.mjs`** — a standalone, dependency-free Node script. Reads `src/auth/google-oauth.ts`'s source text directly (regex on `export const GOOGLE_OAUTH_SCOPE = '...';`) and compares it against a hardcoded `EXPECTED_SCOPE`, independent of the regular test suite and of any application code import. Exits non-zero with a specific, actionable message naming the expected and actual values if they differ, or if the declaration can't be found at all (e.g., after a refactor that changes its shape). The comparison logic (`extractActualScope`/`EXPECTED_SCOPE`) is exported so it can be unit-tested without spawning a subprocess or mutating the real source file.
- **`.github/workflows/ci.yml`** — a new `oauth-scope-guard` job, named and listed separately on a PR's checks (same pattern as the existing `secret-scanning` job), not folded into the main `Lint, typecheck, test` job. Needs no `npm ci` — the script has zero dependencies.
- **`apps/api/scripts/check-oauth-scope.test.ts`** — unit tests for the extraction/comparison logic.
- **`apps/api/eslint.config.js`** — a small, scoped addition: `no-undef` (from `js.configs.recommended`) is disabled for `.ts` files by `tseslint.configs.recommended`, but a plain `.mjs` script gets no such exemption in ESLint's flat config (there's no auto-detected "Node environment" the way legacy `.eslintrc`'s `env: { node: true }` provided) — this is the first plain script in this workspace, so a `files: ['scripts/**/*.mjs']` override declaring `process`/`console`/`URL` as globals was needed.
- **`apps/api/package.json`** — a new `check-oauth-scope` script entry.

## Key decisions

- **A dedicated, standalone script + its own named CI job, rather than relying solely on the existing `google-oauth.test.ts` assertion.** That test (already in place since `M3-001`) does catch a scope change — but it and the code it checks live in the same PR's diff, so a widening change could in principle come with a matching edit (or deletion) of that same test, with nothing forcing a reviewer's attention to it specifically. A separate script with its own named CI check makes a scope change maximally visible (its own pass/fail row on the PR) and doesn't depend on the regular test suite staying intact to catch the regression.
- **Hardcode the expected value directly in the script, not in a separate allowlist file.** A separate file would need to be kept in sync with the script and doesn't add real protection beyond what one file already provides — the guard's purpose is making a change conspicuous to a human reviewer, not cryptographically preventing a determined actor from editing every relevant file.
- **Zero dependencies, plain Node script.** Keeps the new CI job fast (no `npm ci` step) and means the guard can't be silently broken by an unrelated dependency/build issue elsewhere in the stack.

## Deviations from the original task description

None against `M3-011`'s own row (`docs/TASKS.md`: "Automated check that fails CI if the requested OAuth scope list changes without an explicit, reviewed diff," done-when "A test PR that adds a broader Drive scope fails CI with a clear message").

## How it was tested

- **Manual verification of both directions, before writing the automated test**: ran the script against the real, unwidened scope (passes, exit 0); temporarily widened `GOOGLE_OAUTH_SCOPE` to plain `drive` in a throwaway edit, ran the script again (fails, exit 1, with the exact expected/actual values and a clear remediation message), then restored the real file and re-verified it passes again.
- **`apps/api/scripts/check-oauth-scope.test.ts`**: extraction from a synthetic matching declaration, `null` return when no declaration is present, a widened-scope value correctly detected as not matching `EXPECTED_SCOPE`, and the real, currently-committed `google-oauth.ts` matching `EXPECTED_SCOPE` (the actual guard this script exists to run in CI, exercised directly).
- **Full-suite regression + `npm run ci`**: both workspaces green (132/132 API, including the 4 new tests; web unaffected by this `apps/api`-only task).
- **New CI job itself**: not exercisable locally (no GitHub Actions runner in this sandbox) — will be confirmed via real GitHub check-run data on this task's own PR, per the standing CI-verification rule.

## Current status

Done.

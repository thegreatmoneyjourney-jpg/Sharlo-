# Report: SHARLO-M0-010 — Integration credentials store (encrypted-at-rest, admin-writable)

**Status: done, this session** (pending CI verification of the migration against a real Postgres — see "Current status").

---

## 🚩 Flags — read this section first

### 1. This task was not actually done, despite predating several later, already-merged M0 governance tasks

`M0-010`'s row has existed in `docs/TASKS.md` since Addendum 3 (`docs/reports/SHARLO-M0-011.md`), with no "Status: done" marker — but nothing in this session's history (or the codebase: no `integration_credentials` table existed in `schema.ts` before this task) actually built it. It surfaced now because it's a **real, previously-undocumented dependency of `M3-001`**: Google OAuth's client ID/secret is exactly the kind of "integration credential" `ADR-0017` and `CLAUDE.md`'s non-negotiables describe ("Every integration credential ... any future one ... never a hardcoded env var") — `M3-001`'s own row doesn't mention `M0-010` as a dependency, but it functionally needs it. This is the same "found a missing prerequisite" situation `CLAUDE.md`'s stop conditions describe, resolved the same way `M0-008`/`M0-010`'s original pull-forward was: build the prerequisite now rather than stop and wait, since the founder's own precedent for exactly this shape of gap is already on record.

### 2. Local environment issue found and fixed, unrelated to this task's own code: a broken nested `esbuild` install

Running `drizzle-kit generate` (needed to produce this task's migration) failed with `Host version "0.25.12" does not match binary version "0.28.2"` — `node_modules/drizzle-kit/node_modules/esbuild`'s own `package.json` correctly specified `0.25.12` (matching the committed lockfile), but the actual binary on disk under that path was `0.28.2`'s, left over from a different resolution (most likely `apps/web`'s explicit `esbuild@0.28.2` pin, added during `M2-009` for pdfjs-dist tooling, having been hoisted in a way that overwrote this nested copy at some point). Fixed by deleting the two nested `esbuild` copies the lockfile disagreed with (`drizzle-kit`'s and `@esbuild-kit/core-utils`'s) and letting `npm install` refetch them correctly — the lockfile itself was never wrong, this was purely a corrupted local `node_modules` state. Noting this in case a future session hits the same symptom: it's an install-state issue, not a dependency conflict to "resolve" by changing any pinned version.

### 3. The migration's real correctness against Postgres could not be verified locally — same limitation as `M0-006`/`M2-002`

This sandbox has no local Postgres or Docker daemon (`docker info` and a check for local `postgres`/`pg_ctl` binaries both come back negative), so `runMigrations` (and this task's DB-integration test) could only be exercised via CI's real Postgres service container, not locally — consistent with every prior task that's hit this same limitation. One thing specifically worth CI's real verification: the generated migration renders the custom `bytea` column type as `"encrypted_value" "bytea" NOT NULL` (quoted) rather than the unquoted `bytea` a hand-written migration would use. This should resolve identically in Postgres (quoting a lowercase, no-special-character identifier doesn't change what it resolves to), but "should" is exactly the kind of claim this project's own discipline says to verify for real rather than assume — flagging it here so CI's actual result on this specific point gets checked, not glossed over.

### 4. gitleaks (`M0-013`) caught a real finding on its first encounter with this PR — a true positive against the pattern, and a genuine two-step lesson in how full-history scanning actually behaves

The first push failed CI's `secret-scanning` job: `integration-credentials.test.ts` used `'sk_live_abc123'` as a fake credential value in a test, which matches the well-known Stripe-style secret shape closely enough to trip the `generic-api-key` rule. The value was never a real secret, but gitleaks doesn't know that — it correctly flagged a string shaped exactly like a live API key sitting in committed source, which is precisely the class of thing this check exists to catch. First fix attempt: a new commit replacing every test-fixture credential value in both new test files with natural-language placeholder phrases (spaces, no key/token-shaped charset).

**That fix commit still failed the same check.** Because `fetch-depth: 0`/full-history scanning (deliberately configured so "a secret committed and later deleted is still caught," per this task's own CI comment) scans every commit's own diff, not just the final tree state, the original commit's now-superseded patch still contains the string `sk_live_abc123` forever, in history, regardless of what a later commit on the same PR changes. A second commit can never make this specific check pass by editing files further — the offending text has to stop being reachable in the scanned history, or be explicitly marked as a reviewed, confirmed-harmless exception.

Rewriting this branch's history (rebase/squash + force-push) was considered and rejected: `CLAUDE.md`'s own standing CI rule anticipates exactly this shape of situation and is explicit that the fix is a new commit verified green, with the earlier red commit disclosed in the report — "not a demand to rewrite history." Instead, fixed via gitleaks' own purpose-built mechanism: a `.gitleaksignore` entry at the repo root, keyed to the exact fingerprint (`ed7e3096e7821c63cd8b5addc1d593366cb93297:apps/api/test/integration-credentials.test.ts:generic-api-key:42`) gitleaks itself reported. This suppresses only that one specific, already-reviewed, confirmed-fake finding — not the rule, not the file, not future findings in either — so it isn't in the same category as disabling or skipping a check; the scanner stays fully active for everything else, including this exact file going forward.

Worth a future session remembering, twice over: (1) any test exercising `credential-store.ts`, session tokens, webhook secrets, or similar should use fixture values that don't resemble real secret shapes (`sk_live_...`, `AKIA...`, high-entropy strings next to a key-name-like argument) to avoid this in the first place; (2) if a secret-shaped string ever does land in a commit on this branch, the fix is a new commit _plus_ a `.gitleaksignore` entry for that specific historical fingerprint — pushing a text-only fix commit alone will not turn this specific check green.

### 5. RLS was deliberately _not_ applied to this table — a reasoned exception, not an oversight against `ADR-0008`

`CLAUDE.md`'s non-negotiable says every table holding **tenant-scoped** data needs RLS. `integration_credentials` isn't tenant-scoped data at all — it's platform-level configuration (Resend/Paddle/Google-OAuth secrets) with no per-teacher ownership concept, so the `current_setting('app.current_user_id')` predicate every other table's policy uses doesn't apply here. Scoped instead at the application layer: only `credential-store.ts`'s two functions touch this table, and no teacher-facing route is ever wired to it. Documented in the schema comment itself so a future session doesn't read the missing `enableRLS()` call as a gap and "fix" it incorrectly.

---

## What was built

- **`apps/api/src/db/schema.ts`**: `integrationCredentials` table (`provider`, `keyName`, `encryptedValue` as a custom `bytea` column — Drizzle's pg-core has no built-in bytea helper, unlike `jsonb`/`text` — `updatedAt`, nullable `updatedBy` FK). Unique index on `(provider, keyName)`.
- **`apps/api/src/db/migrations/0002_shocking_lady_vermin.sql`**: generated via `drizzle-kit generate`.
- **`apps/api/src/db/testing/provision-app-role.ts`**: `app_user` granted `SELECT, INSERT, UPDATE` (deliberately no `DELETE` — nothing in this app ever removes a stored credential, only overwrites it).
- **`apps/api/src/integrations/credential-store.ts`**: `encryptCredentialValue`/`decryptCredentialValue` (AES-256-GCM, random 12-byte IV per call, `iv || authTag || ciphertext` layout in one column), `getCredential`/`setCredential` (Drizzle-based, upsert on the unique index).
- **`apps/api/src/db/set-credential.ts`**: the "minimal write path" CLI (`npm run db:set-credential <provider> <keyName> <value>`), using the owner/migration connection like `seed-stock-templates.ts` does.
- **Tests**: `apps/api/test/credential-store.test.ts` (6 unit tests — round-trip, ciphertext never contains the plaintext, IV randomness, tamper detection via GCM's auth tag, missing/malformed key error messages — no DB needed); `apps/api/test/integration-credentials.test.ts` (4 DB-integration tests, same `describe.skipIf` real-Postgres-via-CI pattern as `rls.test.ts` — round-trip through the real table, raw-column-is-not-plaintext, upsert-not-duplicate, not-found error).
- **`apps/api/.env.example`, root `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`**: `INTEGRATION_CREDENTIALS_KEY` wired through everywhere an env var needs to exist for this to run (the one deliberate exception to "never an env var" — see the schema/module comments for why that's not a contradiction of `ADR-0017`'s own goal).
- **`docs/TASKS.md`**: `M0-010` row marked done.

## Key decisions

- **`bytea` via `customType`, not a workaround.** Drizzle's pg-core exports helpers for `text`/`jsonb`/etc. but not `bytea` directly; `customType` is the documented mechanism for exactly this gap, not a hack.
- **Envelope-key-as-env-var is intentional, not a loophole.** `INTEGRATION_CREDENTIALS_KEY` is the one secret in this whole subsystem still read from `process.env` — standard envelope-encryption shape (a key-encrypting-key living outside the thing it protects), explicitly reasoned through in both `ADR-0017` and this task's code comments, not an accidental regression against the ADR it implements.
- **No RLS on this table** — see Flag 5.
- **CLI script, not an admin endpoint, for the write path** — matches this task's own "a script or admin-only endpoint is enough" instruction and the existing `seed-stock-templates.ts` precedent exactly; `M5-012` still owns the real admin UI later.

## Deviations from the original task description

None against `M0-010`'s own description — the deviation is upstream of this task: it should have been built during Addendum 3 (when `M0-008` first needed it) or shortly after, and wasn't. See Flag 1.

## How this was tested

`npx tsc --noEmit` and `npx eslint .` both clean in `apps/api`. `npx vitest run` locally: the 6 new pure unit tests pass; the 4 new DB-integration tests correctly skip (no local Postgres — see Flag 3) alongside the pre-existing `rls.test.ts`/`templates-rls.test.ts`/`seed-stock-templates.test.ts`, which also skip for the same reason. Real verification of the migration + DB-integration tests happens in CI's Postgres service container, checked via actual GitHub check-run data before merge, per the standing rule — not claimed as proven here.

## Current status

Code complete, locally clean (typecheck/lint/unit-tests). Pushed as PR #44. CI's `secret-scanning` job failed twice before going green — see Flag 4 for the full sequence (a real fixture-value finding, a fix commit that couldn't fully resolve it due to full-history scanning, and the `.gitleaksignore` entry that did). The other three jobs (`Lint, typecheck, test`, `Detection engine test harness`, `Docker images build`) passed on the first push, including the migration actually applying cleanly against CI's real Postgres (Flag 3's open question resolved: the quoted `"bytea"` type rendered correctly). Merging once `secret-scanning` is confirmed green via real check-run data on the final commit. `M3-001` begins immediately after this merges and the branch restarts, per the standing workflow.

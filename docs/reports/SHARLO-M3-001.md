# Report: SHARLO-M3-001 + M3-002 — Google OAuth PKCE redirect flow + session management

**Status: done, this session** (pending CI verification against a real Postgres — see "Current status").

Covers both `M3-001` (Google OAuth redirect flow) and `M3-002` (Session management), built and reported together — see Flag 1 for why.

---

## 🚩 Flags — read this section first

### 1. M3-001 and M3-002 were built together, in one PR — a deliberate exception to this project's usual one-task-per-report granularity

An OAuth flow that authenticates a Google identity but never establishes an app session isn't a complete, testable feature — there's nothing to observe at the end of it. `M3-001`'s own "done when" and `M3-002`'s own "done when" only become checkable together. Both get their own `docs/TASKS.md` row update, both are covered in full below, but there's one report and one PR, not two, because splitting the diff would mean an intermediate commit that doesn't actually work end to end — exactly the "half-finished implementation" `CLAUDE.md` says not to ship.

### 2. A real, previously-undocumented dependency: `M0-010` had to be built first

Google's OAuth `client_id`/`client_secret` are exactly the kind of integration credential `ADR-0017`/`CLAUDE.md`'s non-negotiables require go through the encrypted `integration_credentials` table, never a hardcoded env var — but that table didn't exist; `M0-010` was a stale, never-actually-built task from Addendum 3. Built it first, as its own task/PR/report (`docs/reports/SHARLO-M0-010.md`), merged before this one started. Not re-explained in full here — see that report for gitleaks catching a real fixture-value finding along the way and the `.gitleaksignore` fix that required.

### 3. A real, more serious gap found while implementing this: `users`' own RLS policy would have blocked the app from ever creating a new user

This is the most significant finding in this task. `users_self_access_only` (the RLS policy `M0-006` shipped) requires `id = current_setting('app.current_user_id')` for every operation, including INSERT — but a brand-new user, by definition, doesn't have a `current_user_id` claim yet (that claim doesn't exist until a session establishes it, and a session doesn't exist until the user does). First-time Google sign-in needs the app's own **restricted** `app_user` connection to insert a new row from nothing, and separately, needs to look up "does an account for this `google_sub` already exist" _before_ any id — and therefore any tenant context — exists to scope that lookup with.

`M0-006`'s original RLS proof (`test/rls.test.ts`) never caught this because it only ever _read_ fixture rows that had been seeded through the **privileged/owner** connection, in `beforeAll`. It never exercised "the restricted connection inserts a brand-new row from scratch," which is exactly what a live sign-in needs and every prior task in this project has needed the owner connection or a pre-seeded fixture for instead. This wasn't a bug anyone shipped and later found — it's the first time any code path actually needed the restricted connection to create its own tenant identity, and the gap was there from the start.

**Fixed with the same tool RLS already uses, not a bypass:**

- A second, additive, permissive SELECT policy on `users` (`users_select_by_google_sub_lookup`), scoped against a new GUC (`app.google_sub_lookup`) instead of `current_user_id` — Postgres ORs permissive policies together, so this only ever _adds_ visibility (a row matching the Google subject currently signing in), never _removes_ the existing self-access guarantee.
- For INSERT, the new row's id is generated in application code (`randomUUID()`, not the column's `defaultRandom()`) specifically so `withTenantContext(db, newId, ...)` can set `current_user_id` to the _same_ id the row is about to get, satisfying the existing policy's `WITH CHECK` without weakening it at all.
- The exact same shape already existed for `sessions`' own "look up by raw token before any identity is known" problem (`app.session_lookup_token`) — this generalizes that pattern (`apps/api/src/db/client.ts`'s `withGucContext`) rather than inventing a second mechanism.

This is flagged prominently, not just fixed quietly, because it's a real correctness gap in previously-shipped, previously-reported-as-done code (`M0-006`), and because the pattern (a purpose-built lookup GUC for "prove who you are" queries that precede tenant context) is one a future session adding a similar alternate-identifier lookup should reuse rather than rediscover. See `docs/ARCHITECTURE.md` §9 and §15 item 14, and `apps/api/src/db/client.ts`'s doc comments.

### 4. A second, more subtle RLS gap in the exact same area — DELETE silently affecting zero rows — caught by CI, not by review

`sessions`' SELECT policy is scoped against `app.session_lookup_token`; its DELETE policy is scoped against `app.current_user_id` (Flag 3's pattern, deliberately using different GUCs for different operations on the same table). The first version of `destroySession` set only `current_user_id` before deleting — which satisfies the DELETE policy's own `USING` clause, but Postgres also requires the target row to be visible per an _applicable SELECT-side_ policy before an UPDATE/DELETE can touch it at all. Since `session_lookup_token` was never set in that transaction, the row was invisible for that purpose, and the DELETE silently affected zero rows — **no error, nothing in the logs, just a `sessions` row that was never actually removed.**

This was caught by `session.test.ts`'s own "destroySession removes the row" test failing in CI (`expected {…} to be null`, got the still-there row back from `validateSessionToken`) — not by re-reading the policy definitions, and this environment's blocked network egress meant PostgreSQL's own documentation on UPDATE/DELETE-target visibility couldn't be independently re-confirmed either (`postgresql.org` returned the same `EGRESS_BLOCKED` result as `developer.paddle.com` earlier in this project). The CI failure itself is the evidence relied on here, not a docs citation. Fixed by generalizing `client.ts`'s GUC helper to set more than one GUC per transaction (`withSessionDeleteContext`), so `destroySession` now sets both — the row is visible (via `session_lookup_token`) _and_ ownership is checked (via `current_user_id`), neither weakening the other. `findOrCreateUserByGoogleIdentity`'s UPDATE path (existing-user refresh-token update) does **not** have this problem: `users`' self-access policy is `for: 'all'`, one predicate covering SELECT/INSERT/UPDATE/DELETE consistently, so `current_user_id` alone already satisfies the visibility check there — this gap is specific to a table with genuinely different GUCs per operation, which today is only `sessions`.

**Worth remembering for any future table that scopes different operations against different lookup GUCs (the same pattern as `sessions`, per Flag 3's reasoning): an UPDATE or DELETE needs every GUC its SELECT policy _and_ its own policy depend on, set together in the same transaction — not just the GUC its own operation-specific policy checks.**

### 5. Google's refresh token is stored now, encrypted, even though nothing reads it yet

`M3-006` ("Drive file CRUD, browser-direct") needs the **browser** to hold a Google Drive access token — but the OAuth code exchange in this task happens **server-side** (a confidential client, with a real `client_secret`), so the server, not the browser, is who actually receives tokens from Google. Neither `M3-001` nor `M3-006`'s task descriptions name this hand-off explicitly, which is itself a real, if minor, gap in `docs/TASKS.md`'s task breakdown (per `CLAUDE.md`'s stop condition, "a real prerequisite not captured as a dependency" — noted here rather than silently patched over).

Rather than leave a gap for `M3-006` to discover blocked, this task requests `access_type=offline` + `prompt=consent` (so Google actually issues a refresh token) and stores it encrypted on `users.google_refresh_token_encrypted` (reusing `credential-store.ts`'s AES-256-GCM functions directly — the same underlying requirement, a secret the server must read in plaintext to do its job, just per-user rather than platform-wide, so it gets its own column rather than living in `integration_credentials`). **Not built here:** the actual "give the browser a fresh Drive access token" endpoint — that's `M3-006`'s own scope. The point of storing the refresh token now is specifically so `M3-006` doesn't have to force every existing user through a second full consent screen just to backfill something this task could reasonably capture on the first pass.

### 6. iOS Safari / popup-blocking: verified by construction, not against a real device

`M3-001`'s "done when" says "works on iOS Safari without popup-blocked failures." No `window.open`/popup API is used anywhere in this flow — `/auth/google/start` is a plain HTTP redirect (`reply.redirect(...)`), and Google's own callback is a server-side redirect back to `/auth/google/callback`, so there is no popup for Safari (or any browser) to block, by construction. This sandbox has no real iOS device to test on, same limitation `M1-011` already exists to cover for the scanning engine — noted here rather than claimed as verified on real hardware.

### 7. CSRF protection is tested against a throwaway route — no real mutating business route exists yet

`M3-002`'s "done when" asks for "a CSRF test confirms a cross-site POST is rejected." The double-submit mechanism (`apps/api/src/auth/csrf.ts` + a global `preHandler` hook, `csrf-protection.ts`) is fully built and wired into `app.ts` for every route on the instance — but the only routes that exist today are two GETs (`/auth/google/start`/`callback`) and `/health`, all exempt by method. `test/csrf-protection.test.ts` registers a one-off `POST /test/mutate` route directly on the built app purely to exercise the hook, the same pattern as testing any cross-cutting middleware in isolation before a real consumer exists. The hook itself needs no changes when the first real mutating route (`M3-003` onward) is added — it isn't route-specific.

### 8. `M3-011` (the OAuth-scope CI guard) is not this task — a step toward it exists, not the guard itself

`google-oauth.test.ts` asserts `GOOGLE_OAUTH_SCOPE`'s exact literal value, which would fail CI (with a clear diff) if the scope list changed — but `M3-011`'s own description asks for something more deliberate ("fails CI if the requested OAuth scope list changes **without an explicit, reviewed diff**"), which may want a dedicated, named check rather than one assertion inside a larger test file. Left as its own future task, not marked done here, so it isn't quietly under-scoped when it's actually built.

### 9. Local environment: added two new production dependencies, `@fastify/cookie` and `@fastify/cors`

Chosen over hand-rolling cookie signing/parsing and CORS handling — both are official, actively-maintained Fastify-org plugins doing exactly one well-defined, security-relevant job each, the same category of dependency choice as `drizzle-orm`/`zod` already in this codebase, not a departure from its general preference for minimal dependencies. `npm audit` flags 4 moderate-severity findings after installing them, but they're entirely pre-existing (`drizzle-kit`'s own nested `esbuild`/`@esbuild-kit` dev-tooling chain, unrelated to either new package) and out of scope for this task — a known item for `M7-012`'s dependency-audit pass, not introduced here.

---

## What was built

**Schema (`apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`):**

- `sessions` table (token pk, userId FK, csrfToken, createdAt/expiresAt), RLS via the new `app.session_lookup_token` GUC pattern for SELECT, ordinary `current_user_id`-scoped policies for INSERT/DELETE.
- `users.googleRefreshTokenEncrypted` (nullable bytea) — see Flag 5.
- `users_select_by_google_sub_lookup` — the second permissive policy from Flag 3.
- `withGucContext` (generalized), `withSessionLookupContext`, `withGoogleSubLookupContext` in `client.ts`.
- `provision-app-role.ts`: `app_user` granted `SELECT, INSERT, DELETE` on `sessions` (no UPDATE — nothing mutates a session row in place).
- Migrations `0003`–`0005`.

**Auth modules (`apps/api/src/auth/`):**

- `pkce.ts` — verifier/challenge/state generation (RFC 7636 S256), verified against the RFC's own Appendix B worked example, not just internal self-consistency.
- `google-oauth.ts` — authorization URL builder, token exchange, userinfo fetch. Plain `fetch`, no OAuth client library; `fetch` is injectable for tests.
- `user-account.ts` — `findOrCreateUserByGoogleIdentity` (the RLS-safe find-or-create from Flag 3).
- `session.ts` — `createSession`/`validateSessionToken`/`destroySession`.
- `csrf.ts` — constant-time double-submit token comparison.
- `csrf-protection.ts` — the global `preHandler` hook.
- `request-session.ts` — the one shared path for reading+unsigning+validating the session cookie (cookie names live here too, so `auth.ts`'s routes and the CSRF hook can't drift out of sync).

**Routes (`apps/api/src/routes/auth.ts`), wired into `app.ts`/`index.ts`:**

- `GET /auth/google/start` — generates state/PKCE, sets two short-lived signed handshake cookies, redirects to Google.
- `GET /auth/google/callback` — validates state/PKCE, exchanges the code, fetches the profile, finds-or-creates the user, creates a session, sets the session (signed) + CSRF (unsigned, JS-readable) cookies, redirects to the app.
- `@fastify/cookie` (signing) and `@fastify/cors` (single explicit origin + `credentials: true`, never a wildcard) registered on the app.
- `buildApp()`/`index.ts` now take/read `API_BASE_URL`, `APP_BASE_URL`, `COOKIE_SIGNING_SECRET` (new env vars, wired through both `.env.example` files, `docker-compose.yml` — derived from the existing `APP_DOMAIN`/`API_DOMAIN` where possible — and CI's docker-compose validation step).

**Tests** (11 new files/suites, 25 passing locally + 35 skipped pending CI's real Postgres): `pkce.test.ts`, `google-oauth.test.ts`, `csrf.test.ts` run with no DB; `session.test.ts`, `user-account.test.ts`, `auth-routes.test.ts`, `csrf-protection.test.ts` need the real Postgres service container CI provides (same `describe.skipIf` pattern every prior DB-integration test in this codebase uses).

**Docs:** `docs/SRS.md` (fixed a stale `NFR-SEC-03` cross-reference), `docs/ARCHITECTURE.md` §6/§9/§15 (schema sketch, the GUC-lookup design note, resolution-log item 14), `docs/TASKS.md` (`M3-001`/`M3-002` rows), `CLAUDE.md` (decisions log).

## Key decisions

Covered in full in the Flags section above (combining the two tasks, the `users` RLS fix, storing the refresh token now, real-device testing, CSRF's throwaway test route, `M3-011` staying unbuilt, the two new dependencies) — not repeated here.

## Deviations from the original task descriptions

- `M3-001`'s scope grew to include storing an encrypted Google refresh token — not named in its own description, but a real, necessary consequence of the server-side code exchange it does describe (see Flag 5).
- `M3-002`'s scope grew to include the `users` and `sessions` RLS fixes — not part of session management as literally described, but discovered _while_ building the session/account logic this task needed, and blocking without it (see Flags 3–4).
- Both tasks are reported together rather than separately (Flag 1).

## How this was tested

`npx tsc --noEmit` and `npx eslint .` clean throughout. Every `@fastify/cookie`/`@fastify/cors`/`light-my-request` API call used (`setCookie`/`unsignCookie`/`signCookie`, the `cookies` inject option, the parsed `Response.cookies` shape) was checked against that package's actual shipped `.d.ts` in `node_modules` before being relied on, not assumed from memory, specifically because the DB-dependent tests exercising them can't run in this sandbox (no local Postgres). Locally: 25 tests passing across the 3 no-DB-needed suites plus `health.test.ts`; 35 tests across 7 suites correctly skip (need CI's real Postgres) — `rls`/`templates-rls`/`seed-stock-templates` (pre-existing) plus this task's `session`/`user-account`/`auth-routes`/`csrf-protection`. `docker compose config --quiet` validates locally with the three new env vars.

**The first CI push confirmed exactly why this couldn't be fully verified locally**: 59 of 60 tests passed against CI's real Postgres, and the one failure was Flag 4's DELETE bug — `session.test.ts`'s own "destroySession removes the row" test caught it precisely, immediately, with a clear assertion diff (expected `null`, got the still-present row). Fixed and pushed as a second commit on the same PR, re-verified green via a second real CI run before merge — the standing CI rule's exact "investigate and fix the root cause, verify the new head commit" shape, not a retry.

## Current status

Code complete. First CI run: 3 of 4 jobs green immediately (gitleaks, Docker build, Playwright harness); the fourth (`Lint, typecheck, test`) caught Flag 4's real bug via `session.test.ts`, fixed in a follow-up commit, re-verified green via a second real CI run before merge — see "How this was tested."

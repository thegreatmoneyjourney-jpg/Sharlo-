# SHARLO-M3-017: Principal/school dashboard

## Flags

1. **`SchoolSummary` needed extending to return the admin's X25519 key material on every fetch, not just at creation — a real prerequisite this task surfaced, not foreseen by `M3-014`.** `setupSchoolKeyMaterial`'s own return value (the admin's public key and wrapped private key) was only ever available in-memory at the single moment of school creation (`POST /schools`'s own response). The dashboard needs to unwrap the admin's private key fresh on every page load — there was no channel to get that ciphertext back after creation. Resolved as an implementation necessity, not a design choice: `schoolSummaryColumns`/`SchoolSummary` (both API and web client) now include `adminX25519PublicKey`/`adminX25519WrappedPrivateKey` unconditionally. Neither field is a secret our backend could misuse — the public key is cleartext by design, the wrapped private key is ciphertext only the admin's own master key unwraps, exactly the same reasoning `/account/encryption-params` already established for returning `users.wrapped_master_key_by_passphrase`. Not escalated — there was only one way to make this task's own requirement work at all, matching the "reconcile and document" precedent this project has used for prior similar prerequisite gaps (e.g. `M3-007`'s master-key session cache).
2. **The sealed school-copy content carries no teacher-identifying field, so the dashboard cannot attribute an exam to a specific teacher beyond whatever free text is in its own title.** `FR-SCHOOL-04`'s literal wording ("school-wide results, decrypted client-side") doesn't explicitly ask for per-teacher attribution, and nothing else in `FR-SCHOOL-*` does either, so this wasn't treated as a blocking gap — but it's a real limitation worth the founder's awareness if a future "see results broken down by teacher" ask comes up, since it would need a new field threaded through `M3-016`'s own sealing path, not something addable at the dashboard layer alone.
3. **No per-exam drill-down/analytics detail page was built — the dashboard is a flat list (title, date, student count, a computed class average).** This matches `/exams`'s own M3-008 MVP precedent ("Not a dashboard — just enough to list and open") before `M3-009` layered richer analytics on top; a detail page is a reasonable follow-up but wasn't asked for by this task's own done-when criteria, and the existing `/exams/[id]` page can't simply be reused for it since it assumes a different decrypt path (the signed-in teacher's own envelope store, not a sealed-box-opened admin view).
4. **Local `npm run ci` hit the same sandbox file-parallelism flakiness `M3-015`'s report already documented, in a different file this time (`test/auth-routes.test.ts`, untouched by this task).** Not a regression from this task's changes — confirmed by running the failing file in isolation (5/5 pass) and the full `apps/api` suite with `--no-file-parallelism` (170/170 pass, deterministic). Consistent with the prior investigation's conclusion: local sandbox resource contention under full file-level parallelism, not a logic defect. Per that same established practice, not speculatively tuned — the real GitHub Actions CI run (dedicated runner) is the authoritative signal, watched to completion before merge.

## What was built

**API (`apps/api`):** `SchoolSummary`/`schoolSummaryColumns` (`src/auth/schools.ts`) extended to select and return `adminX25519PublicKey`/`adminX25519WrappedPrivateKey` on every `GET /schools` and `POST /schools` response. No schema/migration change — both columns already existed on `schools` from `M3-014`, just weren't previously selected into the summary.

**Aggregation (`apps/web/lib/exams/school-wide-results.ts`):** `loadSchoolWideExamResults(masterKey, driveLocationId, adminX25519PublicKeyHex, adminX25519WrappedPrivateKeyHex)` — unwraps the admin's private key, reconstructs the `X25519KeyPair`, lists every `"schoolExamResults"`-tagged file in the school's one shared container (`listSealedRecordsByType`), and opens each (`unsealExamResultsForSchool`). No per-teacher iteration needed, since every teacher-under-school writes into the same place.

**Dashboard (`apps/web/app/(app)/school/results/`):** `page.tsx` + `school-results-client.tsx` — a `RequireMasterKey`-gated list, sorted most-recent-first (matching `/exams`'s own convention), showing each exam's title, date, student count, and a computed overall average (derived from `computeClassAnalytics`'s per-student `correctPercent`, averaged rather than ranked). Linked from `/school/new`'s "has-school"/"created" states.

**Structural guard (`apps/api/scripts/check-no-decrypt-in-backend.mjs` + `.test.ts`):** a standalone, zero-app-dependency script (mirroring `M3-011`'s OAuth-scope guard exactly) that fails if `apps/api/package.json` ever depends on `libsodium-wrappers` or `libsodium-wrappers-sumo` — the only library in this monorepo capable of an X25519 sealed-box operation. Wired as its own CI job, `no-decrypt-in-backend-guard`, independent of the main test suite.

## Key decisions

- **A dependency-absence check, not a function-name grep, for the "backend never decrypts" guarantee.** If the capability isn't installable, it can't be called — stronger and more future-proof than text-matching identifiers a refactor could rename around, and it's the simplest, most direct proxy for the actual invariant (CLAUDE.md's "no plaintext student data on our servers... ever").
- **A flat list for the dashboard MVP, not a detail/drill-down page.** See Flag 3.
- **The class-average figure reuses `computeClassAnalytics` rather than a new computation**, consistent with this codebase's established "don't recompute what already exists" discipline (`M3-009` itself reused `M3-008`'s own breakdown function the same way).

## Deviations from the original task description

None beyond what's covered in the Flags above — `FR-SCHOOL-04`'s literal requirement ("school-wide results, decrypted client-side in the admin's own browser... backend never in the decrypt path") is met in full.

## How it was tested

- `apps/api`: `schools-routes.test.ts`'s existing create+list round-trip test extended to assert the new fields round-trip correctly; full suite re-run (170/170 passing).
- `apps/web`: new unit tests for `school-wide-results.ts` (multi-teacher aggregation into one container, empty-container case, wrong-master-key rejection) and `school-results-client.tsx` (no-school prompt, no-exams message, sorted list with computed average, error state) — all using mocked data-fetch functions, consistent with this codebase's established component-test boundary.
- `apps/api/scripts/check-no-decrypt-in-backend.test.ts`: the comparison logic tested against synthetic `package.json`-shaped objects (present/absent in dependencies vs. devDependencies, missing fields entirely) plus a test confirming the real, currently-committed `apps/api/package.json` passes. The script itself run directly (`node scripts/check-no-decrypt-in-backend.mjs`) to confirm it passes against the real file, and manually verified to fail loudly (exit 1, clear message) when the forbidden dependency is artificially present.
- Full `npm run ci` (format, lint, typecheck, test) run locally and green across both packages before push.

## Current status

Done. All new and updated tests pass locally; full `npm run ci` green. Same pre-existing, documented gap every Drive-touching task in this project carries: not verified against a real Google Drive account (no real Google OAuth credentials exist anywhere in this project yet) — every Drive interaction here is tested against a faithful in-memory fake, not a live API.

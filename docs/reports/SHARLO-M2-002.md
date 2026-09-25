# Report: SHARLO-M2-002 — Template schema & versioning

**Status: implementation complete, verified against a real local Postgres (not just skipped/CI-only), merged to `main`.**

---

## 🚩 Flags — read this section first

### 1. Two genuine concurrency bugs found and fixed — not by reasoning, by actually running the suite against a real database

This sandbox turned out to have PostgreSQL 16 installed (unlike what earlier reports in this project found — no Docker daemon is available, but the `postgresql-16` package and cluster are present and startable via `service postgresql start`). Rather than accept "skipped, CI will check it" the way `rls.test.ts` (M0-006) had to, I started it, pointed the exact same `DATABASE_URL`/`APP_DATABASE_URL` env vars CI uses at it, and actually ran the full suite for real. That surfaced two real bugs neither code review nor CI's own single-shot run would reliably have caught:

- **`ensureAppRole`'s "check, then create" wasn't safe under concurrent callers.** Adding this task's two new DB-backed test files (`templates-rls.test.ts`, `seed-stock-templates.test.ts`) alongside the pre-existing `rls.test.ts` means three vitest files now independently call `runMigrations` against one shared Postgres instance. Two of them checking "does `app_user` exist" at the same moment, both seeing "no," and both attempting `CREATE ROLE` is a real race — the loser fails with a unique-violation on `pg_authid`'s name index. Fixed by attempting the create unconditionally and treating "the role exists now" (checked _after_ a failed create, regardless of which specific error caused the failure) as success — genuinely idempotent under concurrency, not just under repeated sequential calls.
- **Drizzle's own `migrate()` has the same class of race** — `CREATE SCHEMA IF NOT EXISTS "drizzle"` and the implicit row-type Postgres creates for every `CREATE TABLE` both hit their own unique-index races under true concurrent execution (`IF NOT EXISTS` alone isn't a concurrency guarantee in Postgres). This one matters beyond tests: **two API replicas both running `db:migrate` on startup would hit the identical race in production.** Fixed with a Postgres advisory lock (`pg_advisory_lock`/`_unlock`) wrapping the whole `runMigrations` sequence, serializing concurrent callers instead of racing them.

Confirmed the fix, not just the code: reset the database and reran the full suite **3 times back-to-back** — 13/13 tests passing every time — before treating this as done. Both bugs and both fixes are described in full in the affected files' own doc comments (`provision-app-role.ts`, `migrate.ts`), not just here.

Flagging this prominently because it's exactly the kind of thing CLAUDE.md's standing CI rule is written to prevent shipping as an unexplained intermittent failure later: a future CI run hitting either race (plausible — CI's `postgres` service container is exactly the same "one shared instance, multiple test files" shape that triggered this locally) would have looked like a flake, and the rule is explicit that "re-running hoping for a different result" is not an acceptable response to that. Finding and fixing the actual cause now, with real reproduction, is what the rule asks for.

### 2. Seed data crosses the `apps/web`/`apps/api` package boundary via a checked-in JSON file, not a code import

`seed-stock-templates.ts` (in `apps/api`) reads `apps/web/lib/templates/stock-templates-seed.json` via a relative filesystem path — the one place these two independently-deployable packages touch at all. This is a static-data read, not a code dependency (no `import` from `apps/web`'s TypeScript, no build-time coupling), and keeps `TemplateGeometry`'s canonical definition in the one place that actually needs to understand its shape (the client, which is the only thing that ever interprets `geometry` — the API stores it as opaque JSONB throughout). Flagging the judgment call rather than presenting the cross-package path as an obviously-only option — an alternative would have been duplicating the seed file into `apps/api`, which I rejected as a guaranteed drift risk for no real benefit.

### 3. "A deliberately old-shaped record" is a deliberately-constructed fixture, not real historical data

No real `schemaVersion: 0` template has ever existed — `geometry.ts` has been schema version 1 since M2-001, which merged minutes before this task started. `geometry-migration.ts`'s handled "v0" shape (every bubble implicitly at a hardcoded radius, before `bubbleRadiusPt` became an explicit stored field) is a plausible, deliberately-chosen prior shape, constructed to prove the migration _mechanism_ works before it's ever actually needed — the same reasoning TASKS.md's own wording ("a deliberately old-shaped... record") already signals, not a gap in this report.

---

## What was built

- **`apps/api/src/db/schema.ts`**: the `templates` table (`ARCHITECTURE.md` §6's already-sketched shape) with a genuinely new RLS policy pattern for this codebase — split into 4 per-operation policies (not one `for: 'all'` policy like `users`') because a stock template (`owner_id IS NULL`) needs to be _readable_ by every tenant but _writable_ by none of them through the app role, while a custom template needs the usual owner-only isolation on every operation. A partial unique index (`templates_stock_name_unique`, unique only among `is_stock = true` rows) makes stock-template reseeding idempotent without constraining custom-template names.
- **`apps/api/src/db/migrations/0001_blushing_giant_girl.sql`**: the generated migration (`drizzle-kit generate`, no live DB needed for generation — verified this doesn't require a database connection, unlike `migrate`).
- **`apps/api/src/db/seed-stock-templates.ts`**: loads M2-001's real 3-template seed JSON via the privileged/owner connection (the only connection that can write an `owner_id IS NULL` row, by the RLS design above) — idempotent via `ON CONFLICT` on the new partial unique index.
- **`apps/web/lib/templates/geometry-migration.ts`**: `migrateTemplateGeometry(raw: unknown): TemplateGeometry` — the actual "done when" mechanism, upgrading a recognized older shape or throwing (never guessing) on an unrecognized one.
- **Real-Postgres test coverage** (all skip gracefully without `DATABASE_URL`, same as the existing `rls.test.ts`, but were actually run against a real database this session, not just left skip-only): `apps/api/test/templates-rls.test.ts` (7 cases: stock-visible-to-all, custom-isolated-per-tenant, and — the case `users`' own RLS test never needed — that the app role categorically cannot insert/update/delete a stock template), `apps/api/test/seed-stock-templates.test.ts` (seeding is correct and idempotent), `apps/web/lib/templates/geometry-migration.test.ts` (4 cases, the versioning "done when" proof).
- **Two concurrency fixes** in `apps/api/src/db/testing/provision-app-role.ts` and `apps/api/src/db/migrate.ts` — detailed in Flags.

## Key decisions

Covered in the Flags section (RLS policy shape, cross-package seed data boundary, the deliberately-constructed v0 fixture) — not repeated here.

## Deviations from the task description

None against the task's own wording. The two concurrency fixes are additions the task's own verification work surfaced, not deviations from what was asked.

## How this was tested

- This sandbox has a real local PostgreSQL 16 available (`service postgresql start`) — used it directly rather than settling for "skipped locally, CI will check." Ran the full `apps/api` suite against it repeatedly (including 3 clean back-to-back full-suite runs after the concurrency fixes, specifically to build real confidence a race-condition fix actually holds, not just passed once by luck).
- `npm run ci` at the repo root, run with `DATABASE_URL`/`APP_DATABASE_URL`/`APP_DB_ROLE_PASSWORD` pointed at that real local Postgres — green: format, lint, typecheck, 13/13 API tests (up from 1 real + 3 skipped), 132/132 web tests (up from 128).
- The M1-010 detection harness (`npx playwright test`) re-run to confirm this task's changes (entirely in `apps/api` and `apps/web/lib/templates/`) left it unaffected — still 12/12.

## Current status

Done. Merged to `main`. Continuing into `M2-003` (custom template creation from photo) next, per the standing autonomous-progress rule.

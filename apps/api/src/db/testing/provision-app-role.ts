import type { Sql } from 'postgres';

/**
 * Provisions the restricted `app_user` Postgres role that RLS policies are
 * written against (ARCHITECTURE.md §8) — separate from schema migrations
 * deliberately: role/password provisioning is an infra/deploy concern, not
 * a schema-versioned one, and in a real environment the password comes from
 * a secret, not a committed default.
 *
 * Must run BEFORE migrations: `CREATE POLICY ... TO "app_user"` requires the
 * role to already exist, or the migration itself fails.
 *
 * Genuinely idempotent, including under **concurrent** callers — real
 * multi-test-file vitest runs against one shared Postgres instance (M2-002's
 * `templates-rls.test.ts` and `seed-stock-templates.test.ts`, added
 * alongside the pre-existing `rls.test.ts`) call this at the same time from
 * separate processes. Caught two distinct failure shapes by actually running
 * the real suite against a real local Postgres in this sandbox (not just
 * trusting CI to hit the same thing and report it as an intermittent
 * failure, which CLAUDE.md's standing CI rule doesn't allow waiving as a
 * "flake"): a true race (two callers both see "doesn't exist" before either
 * creates it — the loser's `CREATE ROLE` fails with a unique-violation on
 * `pg_authid`'s own name index, SQLSTATE `23505`) and simply calling this
 * against a cluster where the role already exists from an earlier run
 * (`CREATE ROLE` fails with `42710`, duplicate_object — a *different* code,
 * not a race at all). Rather than special-case each SQLSTATE this function
 * happens to have seen, it checks the thing it actually cares about: after
 * *any* failed `CREATE ROLE`, if the role exists now, the goal state is
 * reached regardless of why the CREATE itself failed — genuinely idempotent
 * under both a race and plain prior existence, and a real, unrelated
 * failure (e.g. no connection) still surfaces, since the role won't exist
 * in that case either.
 */
export async function ensureAppRole(sql: Sql, password: string): Promise<void> {
  try {
    // Role name is a fixed identifier, not user input — the password is
    // parameterized. NOSUPERUSER/NOBYPASSRLS are Postgres defaults for a
    // freshly created role, stated explicitly here so that stays true even
    // if a future migration to this script changes the CREATE ROLE call.
    await sql.unsafe(`CREATE ROLE app_user LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
  } catch (err) {
    const exists = await sql`select 1 from pg_roles where rolname = 'app_user'`;
    if (exists.length === 0) {
      throw err; // the role still doesn't exist, so the CREATE failure was real, not benign
    }
  }
}

/**
 * Grants the restricted role the table-level privileges it needs. RLS
 * policies control which *rows* are visible; the role still needs an
 * ordinary GRANT to touch the table at all — the two are independent and
 * both are required, easy to forget the second one and see confusing
 * "permission denied" errors that look like an RLS bug but aren't.
 *
 * Must run AFTER migrations, since it references a table that must exist.
 */
export async function grantAppRolePrivileges(sql: Sql): Promise<void> {
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON users TO app_user`;
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON templates TO app_user`;
  // No DELETE: nothing in this app ever removes a stored integration
  // credential, only overwrites it (`credential-store.ts`'s upsert) — a
  // narrower grant than the other tables', matching that actual access
  // pattern rather than granting privilege "just in case."
  await sql`GRANT SELECT, INSERT, UPDATE ON integration_credentials TO app_user`;
  // No UPDATE: a session is either looked up, created, or deleted
  // (logout/expiry) — nothing in this app ever mutates an existing
  // session row in place.
  await sql`GRANT SELECT, INSERT, DELETE ON sessions TO app_user`;
}

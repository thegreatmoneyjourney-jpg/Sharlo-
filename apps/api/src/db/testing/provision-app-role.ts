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
 * Idempotent — safe to call on every CI run / local `db:migrate`.
 */
export async function ensureAppRole(sql: Sql, password: string): Promise<void> {
  const exists = await sql`select 1 from pg_roles where rolname = 'app_user'`;
  if (exists.length === 0) {
    // Role name is a fixed identifier, not user input — the password is
    // parameterized. NOSUPERUSER/NOBYPASSRLS are Postgres defaults for a
    // freshly created role, stated explicitly here so that stays true even
    // if a future migration to this script changes the CREATE ROLE call.
    await sql.unsafe(`CREATE ROLE app_user LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
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
}

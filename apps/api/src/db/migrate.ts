import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { ensureAppRole, grantAppRolePrivileges } from './testing/provision-app-role.js';

/**
 * Arbitrary but fixed Postgres advisory-lock key for this whole DB-setup
 * sequence — any consistent bigint works, this one has no other meaning.
 * Session-level (`pg_advisory_lock`/`_unlock`, not `_xact_lock`) because the
 * sequence below spans several separate statements/connections-worth of
 * work (role provisioning, Drizzle's own migration transaction, grants),
 * not one transaction to attach an xact-scoped lock to.
 */
const MIGRATION_LOCK_KEY = 727373;

/**
 * Runs the full DB setup in the order Postgres requires: the `app_user` role
 * must exist before migrations run (policies reference it by name), and
 * privileges can only be granted on the table after migrations create it.
 *
 * Connects with `DATABASE_URL` — the privileged/owner connection, never the
 * restricted `app_user` role this script is provisioning.
 *
 * Wrapped in a cluster-wide advisory lock: **concurrent callers of this
 * function are not just a test-infrastructure hazard** (multiple vitest
 * files each calling this in their own `beforeAll` against one shared
 * Postgres — the scenario that actually caught this, by running the real
 * suite against a real local Postgres rather than trusting CI to hit the
 * same race and report it as an intermittent failure) **but a real
 * production one too**: two API replicas both running `db:migrate` on
 * startup would hit the exact same unique-index races this lock now
 * serializes against — `CREATE ROLE` (`pg_authid`'s name index), `CREATE
 * SCHEMA IF NOT EXISTS "drizzle"` (`pg_namespace`'s name index — `IF NOT
 * EXISTS` alone isn't concurrency-safe in Postgres either), and `CREATE
 * TABLE` (via the table's implicit row type in `pg_type`). Serializing the
 * whole sequence behind one lock is simpler and more robust than special
 * -casing each individual race as it's found.
 */
export async function runMigrations(databaseUrl: string, appUserPassword: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await client`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    try {
      await ensureAppRole(client, appUserPassword);
      await migrate(drizzle(client), { migrationsFolder: './src/db/migrations' });
      await grantAppRolePrivileges(client);
    } finally {
      await client`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  const appUserPassword = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to run migrations.');
    process.exit(1);
  }
  runMigrations(databaseUrl, appUserPassword)
    .then(() => {
      console.log('Migrations applied, app_user role provisioned.');
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}

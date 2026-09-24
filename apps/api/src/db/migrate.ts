import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { ensureAppRole, grantAppRolePrivileges } from './testing/provision-app-role.js';

/**
 * Runs the full DB setup in the order Postgres requires: the `app_user` role
 * must exist before migrations run (policies reference it by name), and
 * privileges can only be granted on the table after migrations create it.
 *
 * Connects with `DATABASE_URL` — the privileged/owner connection, never the
 * restricted `app_user` role this script is provisioning.
 */
export async function runMigrations(databaseUrl: string, appUserPassword: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await ensureAppRole(client, appUserPassword);
    await migrate(drizzle(client), { migrationsFolder: './src/db/migrations' });
    await grantAppRolePrivileges(client);
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

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { setCredential } from '../integrations/credential-store.js';

/**
 * `M0-010`'s "minimal write path" (ADR-0017) — a script, not an admin-panel
 * endpoint, since `M5-012`'s UI doesn't exist yet. Uses the owner/migration
 * connection (like `seed-stock-templates.ts`), since this is a trusted
 * operator running a one-off command, not a tenant-scoped request.
 */
export async function setCredentialCli(
  databaseUrl: string,
  provider: string,
  keyName: string,
  value: string,
): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(client, { schema });
    await setCredential(db, provider, keyName, value);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  const [provider, keyName, value] = process.argv.slice(2);
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to set an integration credential.');
    process.exit(1);
  }
  if (!provider || !keyName || !value) {
    console.error('Usage: tsx src/db/set-credential.ts <provider> <keyName> <value>');
    process.exit(1);
  }
  setCredentialCli(databaseUrl, provider, keyName, value)
    .then(() => {
      console.log(`Stored credential for provider="${provider}" keyName="${keyName}".`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}

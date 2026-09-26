import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { integrationCredentials } from '../src/db/schema.js';
import { getCredential, setCredential } from '../src/integrations/credential-store.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * M0-010 "done when": a credential written through the minimal path is
 * usable server-side and never appears in plaintext in the DB column
 * itself. Same real-Postgres-via-CI-service-container pattern as
 * `rls.test.ts` — see that file for why this is skipped, not failed,
 * when no local Postgres is reachable (this sandbox has none).
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)(
  'integration_credentials: encrypted storage, get/set round-trip',
  () => {
    const ownerClient = postgres(DATABASE_URL!, { max: 1 });
    const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
    const appDb = drizzle(appClient, { schema });
    const testProvider = `test_provider_${randomUUID()}`;

    beforeAll(async () => {
      process.env.INTEGRATION_CREDENTIALS_KEY = randomBytes(32).toString('base64');
      await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
    });

    afterAll(async () => {
      await ownerClient`DELETE FROM integration_credentials WHERE provider = ${testProvider}`;
      await ownerClient.end();
      await appClient.end();
    });

    it('stores a credential and reads back the original plaintext', async () => {
      await setCredential(appDb, testProvider, 'api_key', 'sk_live_abc123');
      const value = await getCredential(appDb, testProvider, 'api_key');
      expect(value).toBe('sk_live_abc123');
    });

    it('never stores the plaintext value in the encrypted_value column', async () => {
      await setCredential(appDb, testProvider, 'client_secret', 'super-secret-oauth-value');

      const rows = await ownerClient`
        select encrypted_value from integration_credentials
        where provider = ${testProvider} and key_name = 'client_secret'
      `;
      const rawColumnValue: Buffer = rows[0]?.encrypted_value;
      expect(rawColumnValue).toBeDefined();
      expect(rawColumnValue.toString('utf8')).not.toContain('super-secret-oauth-value');
    });

    it('upserts on (provider, key_name) — a second write updates the same row, not a duplicate', async () => {
      await setCredential(appDb, testProvider, 'rotatable_key', 'original-value');
      await setCredential(appDb, testProvider, 'rotatable_key', 'rotated-value');

      const rows = await appDb
        .select()
        .from(integrationCredentials)
        .where(
          and(
            eq(integrationCredentials.provider, testProvider),
            eq(integrationCredentials.keyName, 'rotatable_key'),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(await getCredential(appDb, testProvider, 'rotatable_key')).toBe('rotated-value');
    });

    it('throws when no credential is stored for a given provider/keyName', async () => {
      await expect(getCredential(appDb, testProvider, 'never_set')).rejects.toThrow(
        /No integration credential/,
      );
    });
  },
);

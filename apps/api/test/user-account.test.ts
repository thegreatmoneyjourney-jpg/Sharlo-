import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { findOrCreateUserByGoogleIdentity } from '../src/auth/user-account.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * The critical regression this file exists for: a brand-new user must be
 * insertable by the app's own *restricted* `app_user` connection, subject
 * to RLS — not just readable after being seeded through the privileged
 * connection, which is all `rls.test.ts` ever exercised. See
 * `docs/reports/SHARLO-M3-001.md` for how this gap was found.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('findOrCreateUserByGoogleIdentity', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
  const appDb = drizzle(appClient, { schema });
  const googleSub = `google-sub-${randomUUID()}`;
  const email = `user-account-test-${randomUUID()}@example.com`;

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
  });

  afterAll(async () => {
    await ownerClient`DELETE FROM users WHERE google_sub = ${googleSub}`;
    await ownerClient.end();
    await appClient.end();
  });

  it('creates a brand-new user through the restricted app_user connection (the RLS regression this file guards)', async () => {
    const { id } = await findOrCreateUserByGoogleIdentity(appDb, { googleSub, email }, undefined);
    expect(id).toBeTruthy();

    const rawRow =
      await ownerClient`SELECT id, email, google_sub, auth_mode FROM users WHERE id = ${id}`;
    expect(rawRow).toHaveLength(1);
    expect(rawRow[0]?.email).toBe(email);
    expect(rawRow[0]?.google_sub).toBe(googleSub);
    expect(rawRow[0]?.auth_mode).toBe('google');
  });

  it('finds the same user on a second sign-in, rather than creating a duplicate', async () => {
    const first = await findOrCreateUserByGoogleIdentity(appDb, { googleSub, email }, undefined);
    const second = await findOrCreateUserByGoogleIdentity(appDb, { googleSub, email }, undefined);
    expect(second.id).toBe(first.id);

    const rows = await ownerClient`SELECT id FROM users WHERE google_sub = ${googleSub}`;
    expect(rows).toHaveLength(1);
  });

  it('stores a provided refresh token encrypted, never in plaintext', async () => {
    const { id } = await findOrCreateUserByGoogleIdentity(
      appDb,
      { googleSub, email },
      'placeholder refresh token value, not real',
    );

    const rawRow =
      await ownerClient`SELECT google_refresh_token_encrypted FROM users WHERE id = ${id}`;
    const rawValue: Buffer = rawRow[0]?.google_refresh_token_encrypted;
    expect(rawValue).toBeDefined();
    expect(rawValue.toString('utf8')).not.toContain('placeholder refresh token value, not real');
  });

  it('a lookup for a different Google subject creates a distinct account, never returning an unrelated existing row', async () => {
    const { id: thisTestUserId } = await findOrCreateUserByGoogleIdentity(
      appDb,
      { googleSub, email },
      undefined,
    );

    const unrelatedSub = `unrelated-${randomUUID()}`;
    const { id: otherUserId } = await findOrCreateUserByGoogleIdentity(
      appDb,
      { googleSub: unrelatedSub, email: `unrelated-${randomUUID()}@example.com` },
      undefined,
    );

    expect(otherUserId).not.toBe(thisTestUserId);
    const rawRow = await ownerClient`SELECT google_sub FROM users WHERE id = ${otherUserId}`;
    expect(rawRow[0]?.google_sub).toBe(unrelatedSub);

    await ownerClient`DELETE FROM users WHERE id = ${otherUserId}`;
  });
});

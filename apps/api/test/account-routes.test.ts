import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { users } from '../src/db/schema.js';
import { createSession } from '../src/auth/session.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * `M3-005` — `GET /account/me`, the client's only way to learn its own
 * `authMode` without fetching the full (and larger) encryption-params
 * payload. Needed by the local-only warning banner and the settings
 * backup card, both of which must render correctly whether or not
 * encryption setup has completed yet.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('account routes: GET /account/me', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
  const appDb = drizzle(appClient, { schema });

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
  });

  afterAll(async () => {
    await ownerClient.end();
    await appClient.end();
  });

  async function createTestUser(
    authMode: 'google' | 'local_only',
    authProvider: 'google' | 'email_otp',
  ) {
    const testUser = { id: randomUUID(), email: `account-me-test-${randomUUID()}@example.com` };
    const ownerDb = drizzle(ownerClient, { schema: { users } });
    await ownerDb
      .insert(users)
      .values({ id: testUser.id, email: testUser.email, authMode, authProvider });
    return testUser;
  }

  async function cleanupUser(userId: string) {
    await ownerClient`DELETE FROM sessions WHERE user_id = ${userId}`;
    await ownerClient`DELETE FROM users WHERE id = ${userId}`;
  }

  async function buildTestApp() {
    const app = buildApp({
      db: appDb,
      apiBaseUrl: 'https://api.example.com',
      appBaseUrl: 'https://app.example.com',
      useSecureCookies: true,
      cookieSigningSecret: 'test-cookie-signing-secret-value',
    });
    await app.ready();
    return app;
  }

  it('rejects a request with no session', async () => {
    const app = await buildTestApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/account/me' });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('reports authMode: google for a Google-authenticated account', async () => {
    const app = await buildTestApp();
    const user = await createTestUser('google', 'google');
    try {
      const session = await createSession(appDb, user.id);
      const response = await app.inject({
        method: 'GET',
        url: '/account/me',
        cookies: { sharlo_session: app.signCookie(session.token) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ authMode: 'google' });
    } finally {
      await app.close();
      await cleanupUser(user.id);
    }
  });

  it('reports authMode: local_only for an email-OTP-authenticated account', async () => {
    const app = await buildTestApp();
    const user = await createTestUser('local_only', 'email_otp');
    try {
      const session = await createSession(appDb, user.id);
      const response = await app.inject({
        method: 'GET',
        url: '/account/me',
        cookies: { sharlo_session: app.signCookie(session.token) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ authMode: 'local_only' });
    } finally {
      await app.close();
      await cleanupUser(user.id);
    }
  });
});

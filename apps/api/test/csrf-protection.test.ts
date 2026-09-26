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
 * `M3-002` "done when": a CSRF test confirms a cross-site POST is
 * rejected. No real mutating business route exists yet, so this
 * registers a throwaway one directly on the built app purely to exercise
 * `registerCsrfProtection`'s hook — the same pattern as testing any other
 * cross-cutting Fastify hook/middleware in isolation.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('CSRF double-submit protection', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
  const appDb = drizzle(appClient, { schema });
  const testUser = { id: randomUUID(), email: `csrf-test-${randomUUID()}@example.com` };

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
    const ownerDb = drizzle(ownerClient, { schema: { users } });
    await ownerDb
      .insert(users)
      .values({ id: testUser.id, email: testUser.email, authMode: 'google' });
  });

  afterAll(async () => {
    await ownerClient`DELETE FROM sessions WHERE user_id = ${testUser.id}`;
    await ownerClient`DELETE FROM users WHERE id = ${testUser.id}`;
    await ownerClient.end();
    await appClient.end();
  });

  async function buildTestAppWithMutatingRoute() {
    const app = buildApp({
      db: appDb,
      apiBaseUrl: 'https://api.example.com',
      appBaseUrl: 'https://app.example.com',
      useSecureCookies: true,
      cookieSigningSecret: 'test-cookie-signing-secret-value',
    });
    app.post('/test/mutate', async () => ({ ok: true }));
    await app.ready();
    return app;
  }

  it('allows a mutating request with no session cookie at all (nothing to forge yet)', async () => {
    const app = await buildTestAppWithMutatingRoute();
    try {
      const response = await app.inject({ method: 'POST', url: '/test/mutate' });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('allows a mutating request from a valid session with the matching CSRF header', async () => {
    const app = await buildTestAppWithMutatingRoute();
    try {
      const session = await createSession(appDb, testUser.id);
      const response = await app.inject({
        method: 'POST',
        url: '/test/mutate',
        cookies: { sharlo_session: app.signCookie(session.token) },
        headers: { 'x-csrf-token': session.csrfToken },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('rejects a mutating request from a valid session with a missing CSRF header (the cross-site-POST case)', async () => {
    const app = await buildTestAppWithMutatingRoute();
    try {
      const session = await createSession(appDb, testUser.id);
      const response = await app.inject({
        method: 'POST',
        url: '/test/mutate',
        cookies: { sharlo_session: app.signCookie(session.token) },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('rejects a mutating request from a valid session with a mismatched CSRF header', async () => {
    const app = await buildTestAppWithMutatingRoute();
    try {
      const session = await createSession(appDb, testUser.id);
      const response = await app.inject({
        method: 'POST',
        url: '/test/mutate',
        cookies: { sharlo_session: app.signCookie(session.token) },
        headers: { 'x-csrf-token': 'a-completely-wrong-csrf-token-value' },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

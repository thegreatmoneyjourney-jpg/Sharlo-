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
 * `M3-014` — `POST /schools` and `GET /schools`. Every key-material field
 * in the request body is a fixture string the client would really send
 * pre-wrapped/pre-generated (`lib/crypto/school-key.ts`); this route never
 * decrypts or interprets any of them (ADR-0005's zero-knowledge boundary).
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('school routes', () => {
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

  async function createTestUser() {
    const testUser = { id: randomUUID(), email: `schools-route-test-${randomUUID()}@example.com` };
    const ownerDb = drizzle(ownerClient, { schema: { users } });
    await ownerDb.insert(users).values({
      id: testUser.id,
      email: testUser.email,
      authMode: 'google',
      authProvider: 'google',
    });
    return testUser;
  }

  async function cleanupUser(userId: string) {
    await ownerClient`DELETE FROM schools WHERE admin_user_id = ${userId}`;
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

  function validCreateBody(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Riverside Academy',
      driveLocationType: 'folder',
      driveLocationId: 'fixture-drive-folder-id',
      schoolWrappedKeyByAdminMasterKey: 'aabbcc',
      adminX25519PublicKey: 'ddeeff',
      adminX25519WrappedPrivateKey: '001122',
      ...overrides,
    };
  }

  it('rejects POST /schools with no session', async () => {
    const app = await buildTestApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/schools',
        payload: validCreateBody(),
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects a request missing the CSRF header (the global double-submit hook applies to this route too)', async () => {
    const app = await buildTestApp();
    const user = await createTestUser();
    try {
      const session = await createSession(appDb, user.id);
      const response = await app.inject({
        method: 'POST',
        url: '/schools',
        cookies: { sharlo_session: app.signCookie(session.token) },
        payload: validCreateBody(),
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
      await cleanupUser(user.id);
    }
  });

  it('rejects a non-hex key-material field', async () => {
    const app = await buildTestApp();
    const user = await createTestUser();
    try {
      const session = await createSession(appDb, user.id);
      const response = await app.inject({
        method: 'POST',
        url: '/schools',
        cookies: { sharlo_session: app.signCookie(session.token) },
        headers: { 'x-csrf-token': session.csrfToken },
        payload: validCreateBody({ schoolWrappedKeyByAdminMasterKey: 'not-hex-at-all!' }),
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
      await cleanupUser(user.id);
    }
  });

  it('rejects an invalid driveLocationType', async () => {
    const app = await buildTestApp();
    const user = await createTestUser();
    try {
      const session = await createSession(appDb, user.id);
      const response = await app.inject({
        method: 'POST',
        url: '/schools',
        cookies: { sharlo_session: app.signCookie(session.token) },
        headers: { 'x-csrf-token': session.csrfToken },
        payload: validCreateBody({ driveLocationType: 'personal_drive' }),
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
      await cleanupUser(user.id);
    }
  });

  it('creates a school, promotes the account to school_admin, and lists it back via GET', async () => {
    const app = await buildTestApp();
    const user = await createTestUser();
    try {
      const session = await createSession(appDb, user.id);
      const body = validCreateBody();

      const createResponse = await app.inject({
        method: 'POST',
        url: '/schools',
        cookies: { sharlo_session: app.signCookie(session.token) },
        headers: { 'x-csrf-token': session.csrfToken },
        payload: body,
      });
      expect(createResponse.statusCode).toBe(201);
      const created = createResponse.json();
      expect(created).toMatchObject({
        name: body.name,
        driveLocationType: body.driveLocationType,
        driveLocationId: body.driveLocationId,
        // `M3-017` — round-trips the admin's own keypair material back,
        // not just at creation but on every later fetch (below) too.
        adminX25519PublicKey: body.adminX25519PublicKey,
        adminX25519WrappedPrivateKey: body.adminX25519WrappedPrivateKey,
      });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);

      const accountTypeRows =
        await ownerClient`SELECT account_type FROM users WHERE id = ${user.id}`;
      expect(accountTypeRows[0]?.account_type).toBe('school_admin');

      const listResponse = await app.inject({
        method: 'GET',
        url: '/schools',
        cookies: { sharlo_session: app.signCookie(session.token) },
      });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json()).toEqual({
        schools: [
          {
            id: created.id,
            name: body.name,
            driveLocationType: body.driveLocationType,
            driveLocationId: body.driveLocationId,
            adminX25519PublicKey: body.adminX25519PublicKey,
            adminX25519WrappedPrivateKey: body.adminX25519WrappedPrivateKey,
          },
        ],
      });
    } finally {
      await app.close();
      await cleanupUser(user.id);
    }
  });

  it("never returns another admin's school", async () => {
    const app = await buildTestApp();
    const userA = await createTestUser();
    const userB = await createTestUser();
    try {
      const sessionA = await createSession(appDb, userA.id);
      const sessionB = await createSession(appDb, userB.id);

      await app.inject({
        method: 'POST',
        url: '/schools',
        cookies: { sharlo_session: app.signCookie(sessionA.token) },
        headers: { 'x-csrf-token': sessionA.csrfToken },
        payload: validCreateBody({ name: "Tenant A's school" }),
      });

      const listResponseB = await app.inject({
        method: 'GET',
        url: '/schools',
        cookies: { sharlo_session: app.signCookie(sessionB.token) },
      });
      expect(listResponseB.statusCode).toBe(200);
      expect(listResponseB.json()).toEqual({ schools: [] });
    } finally {
      await app.close();
      await cleanupUser(userA.id);
      await cleanupUser(userB.id);
    }
  });
});

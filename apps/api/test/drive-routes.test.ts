import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { users } from '../src/db/schema.js';
import { createSession } from '../src/auth/session.js';
import { encryptCredentialValue, setCredential } from '../src/integrations/credential-store.js';
import type { refreshAccessToken as RefreshAccessTokenFn } from '../src/auth/google-oauth.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * `M3-006` — `POST /account/drive-access-token`'s own HTTP-layer
 * behavior: auth gating, CSRF, and mapping `mintDriveAccessToken`'s
 * thrown errors to the right status codes. `drive-access.test.ts` covers
 * the minting logic itself.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)(
  'drive routes: POST /account/drive-access-token',
  () => {
    const ownerClient = postgres(DATABASE_URL!, { max: 1 });
    const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
    const appDb = drizzle(appClient, { schema });

    beforeAll(async () => {
      process.env.INTEGRATION_CREDENTIALS_KEY = randomBytes(32).toString('base64');
      await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
      await setCredential(appDb, 'google_oauth', 'client_id', 'test-google-client-id');
      await setCredential(appDb, 'google_oauth', 'client_secret', 'test-google-client-secret');
    });

    afterAll(async () => {
      await ownerClient.end();
      await appClient.end();
    });

    async function createGoogleUser(refreshToken: string | null) {
      const id = randomUUID();
      const ownerDb = drizzle(ownerClient, { schema: { users } });
      await ownerDb.insert(users).values({
        id,
        email: `drive-route-test-${id}@example.com`,
        authMode: 'google',
        authProvider: 'google',
        googleRefreshTokenEncrypted: refreshToken ? encryptCredentialValue(refreshToken) : null,
      });
      return id;
    }

    async function cleanupUser(userId: string) {
      await ownerClient`DELETE FROM sessions WHERE user_id = ${userId}`;
      await ownerClient`DELETE FROM users WHERE id = ${userId}`;
    }

    async function buildTestApp(refreshAccessToken: typeof RefreshAccessTokenFn) {
      const app = buildApp({
        db: appDb,
        apiBaseUrl: 'https://api.example.com',
        appBaseUrl: 'https://app.example.com',
        useSecureCookies: true,
        cookieSigningSecret: 'test-cookie-signing-secret-value',
        refreshAccessToken,
      });
      await app.ready();
      return app;
    }

    it('rejects a request with no session', async () => {
      const app = await buildTestApp(vi.fn());
      try {
        const response = await app.inject({ method: 'POST', url: '/account/drive-access-token' });
        expect(response.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('rejects a session request missing the CSRF header', async () => {
      const app = await buildTestApp(vi.fn());
      const userId = await createGoogleUser('a-refresh-token');
      try {
        const session = await createSession(appDb, userId);
        const response = await app.inject({
          method: 'POST',
          url: '/account/drive-access-token',
          cookies: { sharlo_session: app.signCookie(session.token) },
        });
        expect(response.statusCode).toBe(403);
      } finally {
        await app.close();
        await cleanupUser(userId);
      }
    });

    it('returns a fresh access token for a Google account with a stored refresh token', async () => {
      const refreshAccessToken = vi.fn().mockResolvedValue({
        access_token: 'fresh-access-token',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/drive.file',
        token_type: 'Bearer',
      });
      const app = await buildTestApp(refreshAccessToken);
      const userId = await createGoogleUser('a-refresh-token');
      try {
        const session = await createSession(appDb, userId);
        const response = await app.inject({
          method: 'POST',
          url: '/account/drive-access-token',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          accessToken: 'fresh-access-token',
          expiresInSeconds: 3600,
        });
      } finally {
        await app.close();
        await cleanupUser(userId);
      }
    });

    it('returns 409 for an account with no stored Google refresh token (e.g. local-only)', async () => {
      const app = await buildTestApp(vi.fn());
      const userId = await createGoogleUser(null);
      try {
        const session = await createSession(appDb, userId);
        const response = await app.inject({
          method: 'POST',
          url: '/account/drive-access-token',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ error: 'no_google_account' });
      } finally {
        await app.close();
        await cleanupUser(userId);
      }
    });

    it('returns 502 when the Google refresh call itself fails', async () => {
      const refreshAccessToken = vi.fn().mockRejectedValue(new Error('invalid_grant'));
      const app = await buildTestApp(refreshAccessToken);
      const userId = await createGoogleUser('a-now-revoked-refresh-token');
      try {
        const session = await createSession(appDb, userId);
        const response = await app.inject({
          method: 'POST',
          url: '/account/drive-access-token',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
        });
        expect(response.statusCode).toBe(502);
        expect(response.json()).toEqual({ error: 'google_token_refresh_failed' });
      } finally {
        await app.close();
        await cleanupUser(userId);
      }
    });
  },
);

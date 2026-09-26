import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { setCredential } from '../src/integrations/credential-store.js';
import type { GoogleTokenResponse, GoogleUserInfo } from '../src/auth/google-oauth.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * M3-001/M3-002 "done when": the full redirect-based PKCE handshake, real
 * end to end against a real Postgres — start issues the right cookies and
 * redirect, callback validates state/PKCE, upserts the user, creates a
 * session, and sets the session + CSRF cookies. Only Google's own network
 * endpoints are mocked (`googleOAuthClient` injection); everything else
 * (cookie signing, PKCE, the DB, RLS) is the real code path.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('auth routes: Google OAuth PKCE flow', () => {
  const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildTestApp(
    mockProfile: GoogleUserInfo,
    mockTokens: Partial<GoogleTokenResponse> = {},
  ) {
    const exchangeCodeForTokens = vi.fn().mockResolvedValue({
      access_token: 'placeholder-access-token',
      refresh_token: 'placeholder-refresh-token',
      expires_in: 3600,
      scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
      token_type: 'Bearer',
      ...mockTokens,
    } satisfies GoogleTokenResponse);
    const fetchGoogleUserInfo = vi.fn().mockResolvedValue(mockProfile);

    const app = buildApp({
      db: appDb,
      apiBaseUrl: 'https://api.example.com',
      appBaseUrl: 'https://app.example.com',
      useSecureCookies: true,
      cookieSigningSecret: 'test-cookie-signing-secret-value',
      googleOAuthClient: { exchangeCodeForTokens, fetchGoogleUserInfo },
    });
    return { app, exchangeCodeForTokens, fetchGoogleUserInfo };
  }

  async function startOAuthFlow(app: ReturnType<typeof buildApp>) {
    const startResponse = await app.inject({ method: 'GET', url: '/auth/google/start' });
    expect(startResponse.statusCode).toBe(302);

    const location = new URL(startResponse.headers.location as string);
    expect(location.origin + location.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );

    const stateCookie = startResponse.cookies.find((c) => c.name === 'sharlo_oauth_state');
    const verifierCookie = startResponse.cookies.find((c) => c.name === 'sharlo_oauth_verifier');
    if (!stateCookie || !verifierCookie) {
      throw new Error('start route did not set the expected handshake cookies');
    }

    return { state: location.searchParams.get('state')!, stateCookie, verifierCookie };
  }

  async function cleanupUser(googleSub: string) {
    const rows = await ownerClient`SELECT id FROM users WHERE google_sub = ${googleSub}`;
    const id = rows[0]?.id as string | undefined;
    if (id) {
      await ownerClient`DELETE FROM sessions WHERE user_id = ${id}`;
      await ownerClient`DELETE FROM users WHERE id = ${id}`;
    }
  }

  it('completes the full handshake: creates a user, a session, and redirects to /settings (M3-003: the one authenticated page that exists yet, and self-determines setup-vs-change mode)', async () => {
    const googleSub = `google-sub-${randomUUID()}`;
    const email = `auth-route-test-${randomUUID()}@example.com`;
    const { app } = buildTestApp({
      sub: googleSub,
      email,
      email_verified: true,
      name: 'Test Teacher',
    });

    try {
      const { state, stateCookie, verifierCookie } = await startOAuthFlow(app);

      const callbackResponse = await app.inject({
        method: 'GET',
        url: `/auth/google/callback?code=test-auth-code&state=${state}`,
        cookies: {
          [stateCookie.name]: stateCookie.value,
          [verifierCookie.name]: verifierCookie.value,
        },
      });

      expect(callbackResponse.statusCode).toBe(302);
      expect(callbackResponse.headers.location).toBe('https://app.example.com/settings');

      const sessionCookie = callbackResponse.cookies.find((c) => c.name === 'sharlo_session');
      const csrfCookie = callbackResponse.cookies.find((c) => c.name === 'sharlo_csrf');
      expect(sessionCookie?.value).toBeTruthy();
      expect(csrfCookie?.value).toBeTruthy();

      const ownerUserRows = await ownerClient`SELECT id FROM users WHERE google_sub = ${googleSub}`;
      expect(ownerUserRows).toHaveLength(1);

      const sessionRows =
        await ownerClient`SELECT token FROM sessions WHERE user_id = ${ownerUserRows[0]?.id}`;
      expect(sessionRows).toHaveLength(1);
    } finally {
      await app.close();
      await cleanupUser(googleSub);
    }
  });

  it('reuses the existing account on a second login rather than creating a duplicate', async () => {
    const googleSub = `google-sub-${randomUUID()}`;
    const email = `auth-route-test-${randomUUID()}@example.com`;
    const { app } = buildTestApp({ sub: googleSub, email, email_verified: true });

    try {
      for (let i = 0; i < 2; i++) {
        const { state, stateCookie, verifierCookie } = await startOAuthFlow(app);
        const response = await app.inject({
          method: 'GET',
          url: `/auth/google/callback?code=test-auth-code&state=${state}`,
          cookies: {
            [stateCookie.name]: stateCookie.value,
            [verifierCookie.name]: verifierCookie.value,
          },
        });
        expect(response.statusCode).toBe(302);
      }

      const ownerUserRows = await ownerClient`SELECT id FROM users WHERE google_sub = ${googleSub}`;
      expect(ownerUserRows).toHaveLength(1);
    } finally {
      await app.close();
      await cleanupUser(googleSub);
    }
  });

  it('rejects a callback whose state does not match the signed cookie (CSRF-for-the-oauth-dance protection)', async () => {
    const { app } = buildTestApp({
      sub: `google-sub-${randomUUID()}`,
      email: 'x@example.com',
      email_verified: true,
    });
    try {
      const { stateCookie, verifierCookie } = await startOAuthFlow(app);
      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=test-auth-code&state=a-completely-different-state-value',
        cookies: {
          [stateCookie.name]: stateCookie.value,
          [verifierCookie.name]: verifierCookie.value,
        },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects a callback with no handshake cookies at all (e.g. a replayed/forged callback URL)', async () => {
    const { app } = buildTestApp({
      sub: `google-sub-${randomUUID()}`,
      email: 'x@example.com',
      email_verified: true,
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=test-auth-code&state=some-state-value',
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects a callback carrying an OAuth error param (user denied consent)', async () => {
    const { app } = buildTestApp({
      sub: `google-sub-${randomUUID()}`,
      email: 'x@example.com',
      email_verified: true,
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?error=access_denied',
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

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
 * `M3-003` "done when": sign up (persist wrapped key material), change
 * passphrase (persist a re-wrap without touching the recovery wrap). This
 * file only proves the HTTP layer's own job — authorization, request
 * validation, one-time/already-set-up state gating, and that persistence
 * round-trips exactly what was sent. The actual cryptographic correctness
 * of what gets wrapped (all three recovery paths, the negative path) is
 * `apps/web/lib/crypto/master-key.test.ts`'s job, not this file's — this
 * API never sees a passphrase, a Recovery Key, or a master key, only
 * opaque ciphertext, so there is nothing cryptographic for it to verify.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('Encryption setup/change routes', () => {
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
    const testUser = { id: randomUUID(), email: `encryption-test-${randomUUID()}@example.com` };
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
    await ownerClient`DELETE FROM sessions WHERE user_id = ${userId}`;
    await ownerClient`DELETE FROM users WHERE id = ${userId}`;
  }

  /** `M3-004` — backdates `recovery_key_issued_at` directly via SQL, since the normal setup flow always sets it to `now()`. */
  async function setRecoveryKeyIssuedAt(userId: string, issuedAt: Date) {
    await ownerClient`UPDATE users SET recovery_key_issued_at = ${issuedAt.toISOString()} WHERE id = ${userId}`;
  }

  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
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

  const validSetupBody = () => ({
    wrappedMasterKeyByPassphrase: 'ab'.repeat(60),
    wrappedMasterKeyByRecovery: 'cd'.repeat(60),
    kdfSalt: 'ef'.repeat(16),
    kdfParams: { algorithm: 'argon2id', opsLimit: 3, memLimit: 268435456 },
    recoveryKeyVerifier: '12'.repeat(32),
  });

  describe('GET /account/encryption-params', () => {
    it('rejects a request with no session', async () => {
      const app = await buildTestApp();
      try {
        const response = await app.inject({ method: 'GET', url: '/account/encryption-params' });
        expect(response.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('reports hasEncryptionSetup: false for a brand-new account', async () => {
      const app = await buildTestApp();
      const user = await createTestUser();
      try {
        const session = await createSession(appDb, user.id);

        const response = await app.inject({
          method: 'GET',
          url: '/account/encryption-params',
          cookies: { sharlo_session: app.signCookie(session.token) },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ hasEncryptionSetup: false });
      } finally {
        await app.close();
        await cleanupUser(user.id);
      }
    });
  });

  describe('POST /account/encryption-setup', () => {
    it('rejects a request with no session', async () => {
      const app = await buildTestApp();
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/account/encryption-setup',
          payload: validSetupBody(),
        });
        expect(response.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('rejects a session request missing the CSRF header (the global double-submit hook applies to this route too)', async () => {
      const app = await buildTestApp();
      const user = await createTestUser();
      try {
        const session = await createSession(appDb, user.id);

        const response = await app.inject({
          method: 'POST',
          url: '/account/encryption-setup',
          cookies: { sharlo_session: app.signCookie(session.token) },
          payload: validSetupBody(),
        });

        expect(response.statusCode).toBe(403);
      } finally {
        await app.close();
        await cleanupUser(user.id);
      }
    });

    it('rejects a non-hex field', async () => {
      const app = await buildTestApp();
      const user = await createTestUser();
      try {
        const session = await createSession(appDb, user.id);

        const response = await app.inject({
          method: 'POST',
          url: '/account/encryption-setup',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
          payload: { ...validSetupBody(), wrappedMasterKeyByPassphrase: 'not-hex-at-all!' },
        });

        expect(response.statusCode).toBe(400);
      } finally {
        await app.close();
        await cleanupUser(user.id);
      }
    });

    it('persists the wrapped key material, retrievable via GET, and rejects a second setup attempt', async () => {
      const app = await buildTestApp();
      const user = await createTestUser();
      try {
        const session = await createSession(appDb, user.id);
        const body = validSetupBody();

        const setupResponse = await app.inject({
          method: 'POST',
          url: '/account/encryption-setup',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
          payload: body,
        });
        expect(setupResponse.statusCode).toBe(204);

        const getResponse = await app.inject({
          method: 'GET',
          url: '/account/encryption-params',
          cookies: { sharlo_session: app.signCookie(session.token) },
        });
        expect(getResponse.statusCode).toBe(200);
        expect(getResponse.json()).toEqual({ hasEncryptionSetup: true, ...body });

        // Second attempt must not silently overwrite the first — see
        // account-encryption.ts's own doc comment for why that would be
        // unrecoverable, not just a minor bug.
        const secondAttempt = await app.inject({
          method: 'POST',
          url: '/account/encryption-setup',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
          payload: validSetupBody(),
        });
        expect(secondAttempt.statusCode).toBe(409);
      } finally {
        await app.close();
        await cleanupUser(user.id);
      }
    });
  });

  describe('POST /account/encryption-passphrase', () => {
    it('rejects a request with no session', async () => {
      const app = await buildTestApp();
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/account/encryption-passphrase',
          payload: {
            wrappedMasterKeyByPassphrase: 'ab'.repeat(60),
            kdfSalt: 'ef'.repeat(16),
            kdfParams: { algorithm: 'argon2id', opsLimit: 3, memLimit: 1 },
          },
        });
        expect(response.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('rejects changing a passphrase before encryption has ever been set up', async () => {
      const app = await buildTestApp();
      const user = await createTestUser();
      try {
        const session = await createSession(appDb, user.id);

        const response = await app.inject({
          method: 'POST',
          url: '/account/encryption-passphrase',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
          payload: {
            wrappedMasterKeyByPassphrase: 'ab'.repeat(60),
            kdfSalt: 'ef'.repeat(16),
            kdfParams: { algorithm: 'argon2id', opsLimit: 3, memLimit: 1 },
          },
        });

        expect(response.statusCode).toBe(409);
      } finally {
        await app.close();
        await cleanupUser(user.id);
      }
    });

    it('re-wraps the passphrase path only — the recovery wrap and verifier are untouched', async () => {
      const app = await buildTestApp();
      const user = await createTestUser();
      try {
        const session = await createSession(appDb, user.id);
        const originalSetup = validSetupBody();

        await app.inject({
          method: 'POST',
          url: '/account/encryption-setup',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
          payload: originalSetup,
        });

        const newWrap = {
          wrappedMasterKeyByPassphrase: '99'.repeat(60),
          kdfSalt: '88'.repeat(16),
          kdfParams: { algorithm: 'argon2id', opsLimit: 4, memLimit: 1073741824 },
        };
        const changeResponse = await app.inject({
          method: 'POST',
          url: '/account/encryption-passphrase',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
          payload: newWrap,
        });
        expect(changeResponse.statusCode).toBe(204);

        const getResponse = await app.inject({
          method: 'GET',
          url: '/account/encryption-params',
          cookies: { sharlo_session: app.signCookie(session.token) },
        });
        const stored = getResponse.json();

        expect(stored.wrappedMasterKeyByPassphrase).toBe(newWrap.wrappedMasterKeyByPassphrase);
        expect(stored.kdfSalt).toBe(newWrap.kdfSalt);
        expect(stored.kdfParams).toEqual(newWrap.kdfParams);
        // Untouched by the passphrase-only change:
        expect(stored.wrappedMasterKeyByRecovery).toBe(originalSetup.wrappedMasterKeyByRecovery);
        expect(stored.recoveryKeyVerifier).toBe(originalSetup.recoveryKeyVerifier);
      } finally {
        await app.close();
        await cleanupUser(user.id);
      }
    });
  });

  describe('GET /account/recovery-key-reminder-status', () => {
    it('rejects a request with no session', async () => {
      const app = await buildTestApp();
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/account/recovery-key-reminder-status',
        });
        expect(response.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('reports showBanner: false for a brand-new account (no Recovery Key issued yet)', async () => {
      const app = await buildTestApp();
      const user = await createTestUser();
      try {
        const session = await createSession(appDb, user.id);
        const response = await app.inject({
          method: 'GET',
          url: '/account/recovery-key-reminder-status',
          cookies: { sharlo_session: app.signCookie(session.token) },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ showBanner: false });
      } finally {
        await app.close();
        await cleanupUser(user.id);
      }
    });

    it('reports showBanner: true once 7 days have passed since setup', async () => {
      const app = await buildTestApp();
      const user = await createTestUser();
      try {
        const session = await createSession(appDb, user.id);
        await app.inject({
          method: 'POST',
          url: '/account/encryption-setup',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
          payload: validSetupBody(),
        });
        await setRecoveryKeyIssuedAt(user.id, daysAgo(8));

        const response = await app.inject({
          method: 'GET',
          url: '/account/recovery-key-reminder-status',
          cookies: { sharlo_session: app.signCookie(session.token) },
        });
        expect(response.json()).toEqual({ showBanner: true });
      } finally {
        await app.close();
        await cleanupUser(user.id);
      }
    });
  });

  describe('POST /account/recovery-key-reminder-confirm', () => {
    it('rejects a request with no session', async () => {
      const app = await buildTestApp();
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/account/recovery-key-reminder-confirm',
          payload: {
            wrappedMasterKeyByRecovery: 'ab'.repeat(60),
            recoveryKeyVerifier: '12'.repeat(32),
          },
        });
        expect(response.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('rejects confirming before encryption has ever been set up', async () => {
      const app = await buildTestApp();
      const user = await createTestUser();
      try {
        const session = await createSession(appDb, user.id);
        const response = await app.inject({
          method: 'POST',
          url: '/account/recovery-key-reminder-confirm',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
          payload: {
            wrappedMasterKeyByRecovery: 'ab'.repeat(60),
            recoveryKeyVerifier: '12'.repeat(32),
          },
        });
        expect(response.statusCode).toBe(409);
      } finally {
        await app.close();
        await cleanupUser(user.id);
      }
    });

    it('persists the new recovery wrap, stops the banner, and leaves the passphrase wrap untouched', async () => {
      const app = await buildTestApp();
      const user = await createTestUser();
      try {
        const session = await createSession(appDb, user.id);
        const originalSetup = validSetupBody();
        await app.inject({
          method: 'POST',
          url: '/account/encryption-setup',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
          payload: originalSetup,
        });
        await setRecoveryKeyIssuedAt(user.id, daysAgo(8));

        const rotated = {
          wrappedMasterKeyByRecovery: 'ff'.repeat(60),
          recoveryKeyVerifier: 'ee'.repeat(32),
        };
        const confirmResponse = await app.inject({
          method: 'POST',
          url: '/account/recovery-key-reminder-confirm',
          cookies: { sharlo_session: app.signCookie(session.token) },
          headers: { 'x-csrf-token': session.csrfToken },
          payload: rotated,
        });
        expect(confirmResponse.statusCode).toBe(204);

        const getResponse = await app.inject({
          method: 'GET',
          url: '/account/encryption-params',
          cookies: { sharlo_session: app.signCookie(session.token) },
        });
        const stored = getResponse.json();
        expect(stored.wrappedMasterKeyByRecovery).toBe(rotated.wrappedMasterKeyByRecovery);
        expect(stored.recoveryKeyVerifier).toBe(rotated.recoveryKeyVerifier);
        // Untouched by a Recovery Key rotation:
        expect(stored.wrappedMasterKeyByPassphrase).toBe(
          originalSetup.wrappedMasterKeyByPassphrase,
        );

        const statusResponse = await app.inject({
          method: 'GET',
          url: '/account/recovery-key-reminder-status',
          cookies: { sharlo_session: app.signCookie(session.token) },
        });
        expect(statusResponse.json()).toEqual({ showBanner: false });
      } finally {
        await app.close();
        await cleanupUser(user.id);
      }
    });
  });
});

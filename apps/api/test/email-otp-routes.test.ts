import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import type { EmailMessage, EmailSender } from '../src/email/email-sender.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * `M3-005`/`ADR-0018` — the HTTP layer for email-OTP sign-in: request
 * validation, the generic no-enumeration-signal response shape, rate
 * limiting on both routes (`NFR-SEC-04`), and that a successful verify
 * converges to the exact same session/CSRF cookie issuance the Google
 * OAuth callback uses (`auth-routes.test.ts`'s own pattern for reading
 * `response.cookies`). The email-OTP *logic* itself (invalidation, expiry,
 * attempt cap, wrong-provider) is `email-otp.test.ts`'s job, not this
 * file's — this only proves the routes wire that logic up correctly.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('email-otp routes: /auth/email-otp/*', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
  const appDb = drizzle(appClient, { schema });

  const createdEmails: string[] = [];

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
  });

  afterAll(async () => {
    await ownerClient.end();
    await appClient.end();
  });

  afterEach(async () => {
    for (const email of createdEmails) {
      await ownerClient`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ${email})`;
      await ownerClient`DELETE FROM email_otp_codes WHERE email = ${email}`;
      await ownerClient`DELETE FROM users WHERE email = ${email}`;
    }
    createdEmails.length = 0;
  });

  function uniqueEmail(label: string): string {
    const email = `email-otp-route-${label}-${randomUUID()}@example.com`;
    createdEmails.push(email);
    return email;
  }

  function fakeSender(): { sender: EmailSender; sendMock: ReturnType<typeof vi.fn> } {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    return { sender: { send: sendMock }, sendMock };
  }

  function extractCode(sendMock: ReturnType<typeof vi.fn>, callIndex = 0): string {
    const message = sendMock.mock.calls[callIndex]?.[0] as EmailMessage | undefined;
    const match = message?.text.match(/(\d{6})/);
    if (!match) {
      throw new Error('no 6-digit code found in the sent message');
    }
    return match[1]!;
  }

  function buildTestApp(sender: EmailSender) {
    return buildApp({
      db: appDb,
      apiBaseUrl: 'https://api.example.com',
      appBaseUrl: 'https://app.example.com',
      useSecureCookies: true,
      cookieSigningSecret: 'test-cookie-signing-secret-value',
      emailSender: sender,
    });
  }

  describe('POST /auth/email-otp/request', () => {
    it('rejects a malformed email with 400', async () => {
      const { sender } = fakeSender();
      const app = buildTestApp(sender);
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/email-otp/request',
          payload: { email: 'not-an-email' },
        });
        expect(response.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });

    it('sends a code and returns the generic response for a brand-new email', async () => {
      const { sender, sendMock } = fakeSender();
      const app = buildTestApp(sender);
      const email = uniqueEmail('new');
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/email-otp/request',
          payload: { email },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true });
        expect(sendMock).toHaveBeenCalledTimes(1);
        expect((sendMock.mock.calls[0]?.[0] as EmailMessage).to).toBe(email);
      } finally {
        await app.close();
      }
    });

    it('returns the identical response shape for an email that already has an account (no enumeration signal)', async () => {
      const { sender } = fakeSender();
      const app = buildTestApp(sender);
      const existingEmail = uniqueEmail('existing');
      try {
        await ownerClient`INSERT INTO users (id, email, auth_mode, auth_provider) VALUES (${randomUUID()}, ${existingEmail}, 'local_only', 'email_otp')`;

        const response = await app.inject({
          method: 'POST',
          url: '/auth/email-otp/request',
          payload: { email: existingEmail },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true });
      } finally {
        await app.close();
      }
    });

    it('rate-limits repeated requests from the same caller', async () => {
      const { sender } = fakeSender();
      const app = buildTestApp(sender);
      const email = uniqueEmail('rate-limit');
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 6; i++) {
          const response = await app.inject({
            method: 'POST',
            url: '/auth/email-otp/request',
            payload: { email },
          });
          statuses.push(response.statusCode);
        }
        expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
        expect(statuses[5]).toBe(429);
      } finally {
        await app.close();
      }
    });
  });

  describe('POST /auth/email-otp/verify', () => {
    it('rejects a malformed email with 400', async () => {
      const { sender } = fakeSender();
      const app = buildTestApp(sender);
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/email-otp/verify',
          payload: { email: 'not-an-email', code: '123456' },
        });
        expect(response.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });

    it('rejects a non-6-digit code with 400', async () => {
      const { sender } = fakeSender();
      const app = buildTestApp(sender);
      const email = uniqueEmail('bad-code-shape');
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/email-otp/verify',
          payload: { email, code: '42' },
        });
        expect(response.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });

    it('returns 400 with the outcome for a wrong code', async () => {
      const { sender, sendMock } = fakeSender();
      const app = buildTestApp(sender);
      const email = uniqueEmail('wrong-code');
      try {
        await app.inject({ method: 'POST', url: '/auth/email-otp/request', payload: { email } });
        const code = extractCode(sendMock);
        const wrongCode = code === '000000' ? '111111' : '000000';

        const response = await app.inject({
          method: 'POST',
          url: '/auth/email-otp/verify',
          payload: { email, code: wrongCode },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'invalid_code' });
      } finally {
        await app.close();
      }
    });

    it('on success, issues the same session + CSRF cookies the Google OAuth callback issues, backed by a real session row', async () => {
      const { sender, sendMock } = fakeSender();
      const app = buildTestApp(sender);
      const email = uniqueEmail('success');
      try {
        await app.inject({ method: 'POST', url: '/auth/email-otp/request', payload: { email } });
        const code = extractCode(sendMock);

        const response = await app.inject({
          method: 'POST',
          url: '/auth/email-otp/verify',
          payload: { email, code },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true });

        const sessionCookie = response.cookies.find((c) => c.name === 'sharlo_session');
        const csrfCookie = response.cookies.find((c) => c.name === 'sharlo_csrf');
        expect(sessionCookie?.value).toBeTruthy();
        expect(csrfCookie?.value).toBeTruthy();

        const userRows = await ownerClient`SELECT id FROM users WHERE email = ${email}`;
        expect(userRows).toHaveLength(1);
        const sessionRows =
          await ownerClient`SELECT token FROM sessions WHERE user_id = ${userRows[0]?.id}`;
        expect(sessionRows).toHaveLength(1);
      } finally {
        await app.close();
      }
    });

    it('rate-limits repeated verify attempts from the same caller', async () => {
      const { sender } = fakeSender();
      const app = buildTestApp(sender);
      const email = uniqueEmail('verify-rate-limit');
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 11; i++) {
          const response = await app.inject({
            method: 'POST',
            url: '/auth/email-otp/verify',
            payload: { email, code: '000000' },
          });
          statuses.push(response.statusCode);
        }
        expect(statuses.slice(0, 10)).toEqual(new Array(10).fill(400));
        expect(statuses[10]).toBe(429);
      } finally {
        await app.close();
      }
    });
  });
});

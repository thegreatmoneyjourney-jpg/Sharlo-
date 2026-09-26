import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { requestEmailOtp, verifyEmailOtp } from '../src/auth/email-otp.js';
import type { EmailMessage, EmailSender } from '../src/email/email-sender.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * `M3-005`/`ADR-0018` — the email-OTP mechanism's own logic, independent of
 * the HTTP layer (`email-otp-routes.test.ts` covers that): code issuance,
 * hashing at rest, invalidation of prior outstanding codes on re-request,
 * expiry, the per-code attempt cap, single-use enforcement, and the
 * wrong-provider guard against silently linking/duplicating an account
 * that already exists under a different `authProvider`.
 *
 * Same real-Postgres-via-CI pattern as `user-account.test.ts` — this
 * exercises the restricted `app_user` connection every request handler
 * actually uses, not just the privileged owner connection.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('email-otp: request/verify', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
  const appDb = drizzle(appClient, { schema });

  const createdEmails: string[] = [];

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
  });

  afterAll(async () => {
    await ownerClient.end();
    await appClient.end();
  });

  afterEach(async () => {
    for (const email of createdEmails) {
      await ownerClient`DELETE FROM email_otp_codes WHERE email = ${email}`;
      await ownerClient`DELETE FROM users WHERE email = ${email}`;
    }
    createdEmails.length = 0;
  });

  function uniqueEmail(label: string): string {
    const email = `email-otp-${label}-${randomUUID()}@example.com`;
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

  it('sends a 6-digit code and stores only its hash, never the plaintext code', async () => {
    const { sender, sendMock } = fakeSender();
    const email = uniqueEmail('send');

    await requestEmailOtp(appDb, sender, email);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const code = extractCode(sendMock);
    expect(code).toMatch(/^\d{6}$/);

    const rows = await ownerClient`SELECT code_hash FROM email_otp_codes WHERE email = ${email}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code_hash).not.toBe(code);
    expect(rows[0]?.code_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('never creates a users row on its own — account creation happens only after a code is verified', async () => {
    const { sender } = fakeSender();
    const email = uniqueEmail('no-user-yet');

    await requestEmailOtp(appDb, sender, email);

    const rows = await ownerClient`SELECT id FROM users WHERE email = ${email}`;
    expect(rows).toHaveLength(0);
  });

  it('rejects verification when no code was ever requested for that email', async () => {
    const email = uniqueEmail('never-requested');
    const result = await verifyEmailOtp(appDb, email, '123456');
    expect(result.outcome).toBe('invalid_code');
  });

  it('invalidates a prior outstanding code when a new one is requested for the same email', async () => {
    const { sender, sendMock } = fakeSender();
    const email = uniqueEmail('reissue');

    await requestEmailOtp(appDb, sender, email);
    const firstCode = extractCode(sendMock, 0);

    await requestEmailOtp(appDb, sender, email);
    const secondCode = extractCode(sendMock, 1);

    const firstAttempt = await verifyEmailOtp(appDb, email, firstCode);
    expect(firstAttempt.outcome).toBe('invalid_code');

    const secondAttempt = await verifyEmailOtp(appDb, email, secondCode);
    expect(secondAttempt.outcome).toBe('success');
  });

  it('rejects a code after it has expired', async () => {
    const { sender, sendMock } = fakeSender();
    const email = uniqueEmail('expired');

    await requestEmailOtp(appDb, sender, email);
    const code = extractCode(sendMock);
    await ownerClient`UPDATE email_otp_codes SET expires_at = now() - interval '1 minute' WHERE email = ${email}`;

    const result = await verifyEmailOtp(appDb, email, code);
    expect(result.outcome).toBe('expired');
  });

  it('locks out after 5 wrong attempts, even if the final try uses the correct code', async () => {
    const { sender, sendMock } = fakeSender();
    const email = uniqueEmail('lockout');

    await requestEmailOtp(appDb, sender, email);
    const code = extractCode(sendMock);
    const wrongCode = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      const result = await verifyEmailOtp(appDb, email, wrongCode);
      expect(result.outcome).toBe('invalid_code');
    }

    const finalResult = await verifyEmailOtp(appDb, email, code);
    expect(finalResult.outcome).toBe('too_many_attempts');
  });

  it('creates a local-only, email_otp-provider user on first successful verification', async () => {
    const { sender, sendMock } = fakeSender();
    const email = uniqueEmail('new-user');

    await requestEmailOtp(appDb, sender, email);
    const code = extractCode(sendMock);

    const result = await verifyEmailOtp(appDb, email, code);
    expect(result.outcome).toBe('success');
    if (result.outcome !== 'success') return;

    const rows =
      await ownerClient`SELECT auth_mode, auth_provider FROM users WHERE id = ${result.userId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.auth_mode).toBe('local_only');
    expect(rows[0]?.auth_provider).toBe('email_otp');
  });

  it('finds the same existing user on a later sign-in rather than creating a duplicate', async () => {
    const { sender, sendMock } = fakeSender();
    const email = uniqueEmail('repeat-signin');

    await requestEmailOtp(appDb, sender, email);
    const firstResult = await verifyEmailOtp(appDb, email, extractCode(sendMock, 0));
    expect(firstResult.outcome).toBe('success');

    await requestEmailOtp(appDb, sender, email);
    const secondResult = await verifyEmailOtp(appDb, email, extractCode(sendMock, 1));
    expect(secondResult.outcome).toBe('success');

    if (firstResult.outcome !== 'success' || secondResult.outcome !== 'success') {
      return;
    }
    expect(secondResult.userId).toBe(firstResult.userId);

    const rows = await ownerClient`SELECT id FROM users WHERE email = ${email}`;
    expect(rows).toHaveLength(1);
  });

  it('cannot reuse a code after it has already been successfully verified', async () => {
    const { sender, sendMock } = fakeSender();
    const email = uniqueEmail('single-use');

    await requestEmailOtp(appDb, sender, email);
    const code = extractCode(sendMock);

    const first = await verifyEmailOtp(appDb, email, code);
    expect(first.outcome).toBe('success');

    const second = await verifyEmailOtp(appDb, email, code);
    expect(second.outcome).toBe('invalid_code');
  });

  it('refuses to authenticate an email already registered under a different provider (google), without creating a duplicate account', async () => {
    const email = uniqueEmail('wrong-provider');
    await ownerClient`INSERT INTO users (id, email, auth_mode, auth_provider) VALUES (${randomUUID()}, ${email}, 'google', 'google')`;

    const { sender, sendMock } = fakeSender();
    await requestEmailOtp(appDb, sender, email);
    const code = extractCode(sendMock);

    const result = await verifyEmailOtp(appDb, email, code);
    expect(result.outcome).toBe('wrong_provider');

    const rows = await ownerClient`SELECT id FROM users WHERE email = ${email}`;
    expect(rows).toHaveLength(1);
  });

  it('normalizes email case/whitespace consistently between request and verify', async () => {
    const { sender, sendMock } = fakeSender();
    const rawEmail = uniqueEmail('normalize');
    const shouted = `  ${rawEmail.toUpperCase()}  `;

    await requestEmailOtp(appDb, sender, shouted);
    const code = extractCode(sendMock);

    const result = await verifyEmailOtp(appDb, rawEmail, code);
    expect(result.outcome).toBe('success');
  });
});

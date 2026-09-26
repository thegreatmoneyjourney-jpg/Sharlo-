import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { setCredential } from '../src/integrations/credential-store.js';
import { ResendEmailSender } from '../src/email/resend-email-sender.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * `M3-004`/ADR-0011 — the real Resend HTTP call, with `fetch` injected
 * (mirroring `google-oauth.ts`'s own injectable-fetch pattern) so this
 * test never makes a real network request. The credential *lookup* is
 * real (a real Postgres round-trip through `integration_credentials`),
 * only the outbound HTTP call is mocked.
 */
describe.skipIf(!DATABASE_URL)('ResendEmailSender', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const db = drizzle(ownerClient, { schema });

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
    await setCredential(db, 'resend', 'api_key', 'test-resend-api-key-value');
    await setCredential(db, 'resend', 'from_address', 'reminders@example.com');
  });

  afterAll(async () => {
    await ownerClient.end();
  });

  it('POSTs to the Resend API with the stored key and from-address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const sender = new ResendEmailSender(db, fetchMock);

    await sender.send({
      to: 'teacher@example.com',
      subject: 'Test subject',
      html: '<p>hi</p>',
      text: 'hi',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-resend-api-key-value');
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      from: 'reminders@example.com',
      to: 'teacher@example.com',
      subject: 'Test subject',
      html: '<p>hi</p>',
      text: 'hi',
    });
  });

  it('throws a clear error on a non-OK response, rather than silently swallowing the failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'invalid "from" address',
    });
    const sender = new ResendEmailSender(db, fetchMock);

    await expect(
      sender.send({ to: 'teacher@example.com', subject: 's', html: 'h', text: 't' }),
    ).rejects.toThrow(/422/);
  });

  it('throws (via getCredential) when no Resend credential is stored yet — the expected M0-008-not-done-yet state', async () => {
    const unconfiguredDb = drizzle(postgres(DATABASE_URL!, { max: 1 }), { schema });
    try {
      await ownerClient`DELETE FROM integration_credentials WHERE provider = 'resend'`;
      const sender = new ResendEmailSender(unconfiguredDb, vi.fn());
      await expect(
        sender.send({ to: 'teacher@example.com', subject: 's', html: 'h', text: 't' }),
      ).rejects.toThrow(/No integration credential stored/);
    } finally {
      // Restore for any later test in this file/run.
      await setCredential(db, 'resend', 'api_key', 'test-resend-api-key-value');
      await setCredential(db, 'resend', 'from_address', 'reminders@example.com');
    }
  });
});

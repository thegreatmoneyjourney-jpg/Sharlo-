import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { users } from '../src/db/schema.js';
import type { EmailSender } from '../src/email/email-sender.js';
import { runRecoveryKeyReminderSweep } from '../src/scheduler/recovery-key-reminders.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

const DAY_MS = 24 * 60 * 60 * 1000;
const APP_BASE_URL = 'https://app.example.com';

/**
 * `M3-004`/FR-AUTH-09 — the sweep's own scheduling rule, proven directly
 * against real Postgres rows with controlled `recoveryKeyIssuedAt`/
 * `*SentAt`/`dismissedAt` timestamps (set via direct SQL — the normal API
 * flow always sets `issuedAt = now()`, so historical values have to be
 * seeded by hand to exercise "8 days ago" / "31 days ago" deterministically).
 * A silent logger is passed throughout so an *expected* failure case
 * (the "no Resend credential yet" test) doesn't spam real test output —
 * `runRecoveryKeyReminderSweep`'s `failures` count is asserted instead.
 */
describe.skipIf(!DATABASE_URL)('runRecoveryKeyReminderSweep', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const ownerDb = drizzle(ownerClient, { schema });
  const silentLogger = { error: () => {} };

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
  });

  afterAll(async () => {
    await ownerClient.end();
  });

  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds) {
      await ownerClient`DELETE FROM users WHERE id = ${id}`;
    }
    createdUserIds.length = 0;
  });

  async function seedUser(overrides: {
    recoveryKeyIssuedAt: Date | null;
    recoveryKeyReminder7dSentAt?: Date | null;
    recoveryKeyReminder30dSentAt?: Date | null;
    recoveryKeyReminderDismissedAt?: Date | null;
  }) {
    const id = randomUUID();
    createdUserIds.push(id);
    const email = `reminder-sweep-${id}@example.com`;
    await ownerDb.insert(users).values({
      id,
      email,
      authMode: 'google',
      authProvider: 'google',
      recoveryKeyIssuedAt: overrides.recoveryKeyIssuedAt,
      recoveryKeyReminder7dSentAt: overrides.recoveryKeyReminder7dSentAt ?? null,
      recoveryKeyReminder30dSentAt: overrides.recoveryKeyReminder30dSentAt ?? null,
      recoveryKeyReminderDismissedAt: overrides.recoveryKeyReminderDismissedAt ?? null,
    });
    return { id, email };
  }

  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * DAY_MS);
  }

  function fakeSender(): { sender: EmailSender; sendMock: ReturnType<typeof vi.fn> } {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    return { sender: { send: sendMock }, sendMock };
  }

  /**
   * `runRecoveryKeyReminderSweep` sweeps the *entire* `users` table by
   * design (it's a real cross-tenant scheduled job, not scoped to one
   * account) — every assertion below is scoped to this test's own
   * seeded email(s) via this helper, never to `sendMock`'s raw call
   * count/`result`'s raw totals. Those globals can be legitimately
   * nudged by a *different* test file's own transient, narrow-window
   * fixture (e.g. `encryption-routes.test.ts`'s two tests that
   * deliberately backdate `recovery_key_issued_at` via SQL to exercise
   * the reminder-status endpoint, cleaning up immediately after but
   * still a real, if brief, window) running concurrently against the
   * same shared Postgres instance — a genuine, rare cross-file race,
   * not a bug in the sweep itself. Found via an actual intermittent
   * failure while shipping `M3-007`; root-caused rather than
   * re-run-until-green — see that task's report.
   */
  function remindersSent(sendMock: ReturnType<typeof vi.fn>): { to: string; days: 7 | 30 }[] {
    return sendMock.mock.calls.map((call) => {
      const message = call[0] as { to: string; subject: string };
      return { to: message.to, days: message.subject.startsWith('Final reminder') ? 30 : 7 };
    });
  }

  function remindersSentTo(sendMock: ReturnType<typeof vi.fn>, email: string) {
    return remindersSent(sendMock).filter((reminder) => reminder.to === email);
  }

  it('sends nothing for an account that never completed encryption setup', async () => {
    const user = await seedUser({ recoveryKeyIssuedAt: null });
    const { sender, sendMock } = fakeSender();

    await runRecoveryKeyReminderSweep(ownerDb, sender, APP_BASE_URL, new Date(), silentLogger);

    expect(remindersSentTo(sendMock, user.email)).toEqual([]);
  });

  it('sends nothing before the 7-day threshold', async () => {
    const user = await seedUser({ recoveryKeyIssuedAt: daysAgo(3) });
    const { sender, sendMock } = fakeSender();

    await runRecoveryKeyReminderSweep(ownerDb, sender, APP_BASE_URL, new Date(), silentLogger);

    expect(remindersSentTo(sendMock, user.email)).toEqual([]);
  });

  it('sends the 7-day reminder once 7 days have elapsed, and records it', async () => {
    const user = await seedUser({ recoveryKeyIssuedAt: daysAgo(8) });
    const { sender, sendMock } = fakeSender();

    const result = await runRecoveryKeyReminderSweep(
      ownerDb,
      sender,
      APP_BASE_URL,
      new Date(),
      silentLogger,
    );

    expect(remindersSentTo(sendMock, user.email)).toEqual([{ to: user.email, days: 7 }]);
    expect(result.sevenDaySent).toBeGreaterThanOrEqual(1);

    const [row] =
      await ownerClient`SELECT recovery_key_reminder_7d_sent_at FROM users WHERE id = ${user.id}`;
    expect(row!.recovery_key_reminder_7d_sent_at).not.toBeNull();
  });

  it('does not re-send the 7-day reminder on a later sweep once already sent', async () => {
    const user = await seedUser({
      recoveryKeyIssuedAt: daysAgo(8),
      recoveryKeyReminder7dSentAt: daysAgo(1),
    });
    const { sender, sendMock } = fakeSender();

    await runRecoveryKeyReminderSweep(ownerDb, sender, APP_BASE_URL, new Date(), silentLogger);

    expect(remindersSentTo(sendMock, user.email)).toEqual([]);
  });

  it('sends both the 7-day and 30-day reminder in the same sweep for an account issued 31+ days ago that never had either sent', async () => {
    const user = await seedUser({ recoveryKeyIssuedAt: daysAgo(31) });
    const { sender, sendMock } = fakeSender();

    const result = await runRecoveryKeyReminderSweep(
      ownerDb,
      sender,
      APP_BASE_URL,
      new Date(),
      silentLogger,
    );

    const sentToUser = remindersSentTo(sendMock, user.email);
    expect(sentToUser.map((r) => r.days).sort((a, b) => a - b)).toEqual([7, 30]);
    expect(result.sevenDaySent).toBeGreaterThanOrEqual(1);
    expect(result.thirtyDaySent).toBeGreaterThanOrEqual(1);

    const [row] =
      await ownerClient`SELECT recovery_key_reminder_7d_sent_at, recovery_key_reminder_30d_sent_at FROM users WHERE id = ${user.id}`;
    expect(row!.recovery_key_reminder_7d_sent_at).not.toBeNull();
    expect(row!.recovery_key_reminder_30d_sent_at).not.toBeNull();
  });

  it('sends the 30-day reminder without re-sending the 7-day one, if the 7-day one already went out', async () => {
    const user = await seedUser({
      recoveryKeyIssuedAt: daysAgo(31),
      recoveryKeyReminder7dSentAt: daysAgo(24),
    });
    const { sender, sendMock } = fakeSender();

    await runRecoveryKeyReminderSweep(ownerDb, sender, APP_BASE_URL, new Date(), silentLogger);

    expect(remindersSentTo(sendMock, user.email)).toEqual([{ to: user.email, days: 30 }]);
    const [row] =
      await ownerClient`SELECT recovery_key_reminder_30d_sent_at FROM users WHERE id = ${user.id}`;
    expect(row!.recovery_key_reminder_30d_sent_at).not.toBeNull();
  });

  it('excludes an account that has actively dismissed reminders, however long ago it was issued', async () => {
    const user = await seedUser({
      recoveryKeyIssuedAt: daysAgo(60),
      recoveryKeyReminderDismissedAt: daysAgo(1),
    });
    const { sender, sendMock } = fakeSender();

    await runRecoveryKeyReminderSweep(ownerDb, sender, APP_BASE_URL, new Date(), silentLogger);

    expect(remindersSentTo(sendMock, user.email)).toEqual([]);
  });

  it('leaves the sent-at timestamp unset and counts a failure when the email sender throws, so the next sweep retries', async () => {
    const user = await seedUser({ recoveryKeyIssuedAt: daysAgo(8) });
    const failingSender: EmailSender = { send: vi.fn().mockRejectedValue(new Error('SMTP down')) };

    const result = await runRecoveryKeyReminderSweep(
      ownerDb,
      failingSender,
      APP_BASE_URL,
      new Date(),
      silentLogger,
    );

    expect(result.failures).toBeGreaterThanOrEqual(1);
    const [row] =
      await ownerClient`SELECT recovery_key_reminder_7d_sent_at FROM users WHERE id = ${user.id}`;
    expect(row!.recovery_key_reminder_7d_sent_at).toBeNull();
  });

  it('processes every eligible candidate in one sweep, not just the first', async () => {
    const userA = await seedUser({ recoveryKeyIssuedAt: daysAgo(8) });
    const userB = await seedUser({ recoveryKeyIssuedAt: daysAgo(9) });
    const { sender, sendMock } = fakeSender();

    const result = await runRecoveryKeyReminderSweep(
      ownerDb,
      sender,
      APP_BASE_URL,
      new Date(),
      silentLogger,
    );

    expect(result.sevenDaySent).toBeGreaterThanOrEqual(2);
    expect(remindersSentTo(sendMock, userA.email)).toEqual([{ to: userA.email, days: 7 }]);
    expect(remindersSentTo(sendMock, userB.email)).toEqual([{ to: userB.email, days: 7 }]);
  });
});

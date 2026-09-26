import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import type { EmailSender } from '../email/email-sender.js';
import { buildRecoveryKeyReminderEmail } from '../email/recovery-key-reminder-email.js';

type Db = PostgresJsDatabase<typeof schema>;

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const THIRTY_DAYS_MS = 30 * DAY_MS;

export interface ReminderSweepResult {
  sevenDaySent: number;
  thirtyDaySent: number;
  failures: number;
}

export interface ReminderSweepLogger {
  error(message: string, error: unknown): void;
}

/**
 * ADR-0005 addendum / FR-AUTH-09: exactly one 7-day and one 30-day email
 * per Recovery Key issuance, stopping entirely once the teacher actively
 * re-confirms (`../auth/account-encryption.ts`'s `rotateRecoveryKey` sets
 * `recoveryKeyReminderDismissedAt`, which excludes the account from every
 * future sweep — see that function's own doc comment for why this doesn't
 * restart a new cycle).
 *
 * Must run against the PRIVILEGED/owner connection, not the RLS-scoped
 * `app_user` connection this app's request handlers use — reading every
 * account's reminder state is a genuinely cross-tenant sweep, the same
 * category of operation as a migration or the stock-template seed script,
 * not a per-request query `withTenantContext` is for.
 *
 * A failed send (most likely today: `M0-008`'s Resend account doesn't
 * exist yet, so `emailSender.send()` throws) leaves that reminder's
 * `*SentAt` column untouched — deliberately, so tomorrow's sweep retries
 * it rather than the account silently being marked "reminded" when it
 * never actually received anything.
 */
export async function runRecoveryKeyReminderSweep(
  ownerDb: Db,
  emailSender: EmailSender,
  appBaseUrl: string,
  now: Date = new Date(),
  logger: ReminderSweepLogger = console,
): Promise<ReminderSweepResult> {
  const result: ReminderSweepResult = { sevenDaySent: 0, thirtyDaySent: 0, failures: 0 };

  const candidates = await ownerDb
    .select({
      id: users.id,
      email: users.email,
      recoveryKeyIssuedAt: users.recoveryKeyIssuedAt,
      recoveryKeyReminder7dSentAt: users.recoveryKeyReminder7dSentAt,
      recoveryKeyReminder30dSentAt: users.recoveryKeyReminder30dSentAt,
    })
    .from(users)
    .where(and(isNotNull(users.recoveryKeyIssuedAt), isNull(users.recoveryKeyReminderDismissedAt)));

  for (const candidate of candidates) {
    const issuedAt = candidate.recoveryKeyIssuedAt;
    if (!issuedAt) continue; // narrows the isNotNull filter above for TypeScript
    const elapsedMs = now.getTime() - issuedAt.getTime();

    if (elapsedMs >= SEVEN_DAYS_MS && !candidate.recoveryKeyReminder7dSentAt) {
      try {
        await emailSender.send(buildRecoveryKeyReminderEmail(candidate.email, 7, appBaseUrl));
        await ownerDb
          .update(users)
          .set({ recoveryKeyReminder7dSentAt: now })
          .where(eq(users.id, candidate.id));
        result.sevenDaySent += 1;
      } catch (error) {
        result.failures += 1;
        logger.error(`Recovery Key 7-day reminder failed for user ${candidate.id}`, error);
      }
    }

    if (elapsedMs >= THIRTY_DAYS_MS && !candidate.recoveryKeyReminder30dSentAt) {
      try {
        await emailSender.send(buildRecoveryKeyReminderEmail(candidate.email, 30, appBaseUrl));
        await ownerDb
          .update(users)
          .set({ recoveryKeyReminder30dSentAt: now })
          .where(eq(users.id, candidate.id));
        result.thirtyDaySent += 1;
      } catch (error) {
        result.failures += 1;
        logger.error(`Recovery Key 30-day reminder failed for user ${candidate.id}`, error);
      }
    }
  }

  return result;
}

const SWEEP_INTERVAL_MS = DAY_MS;

/**
 * ADR-0011: "a simple in-process daily scheduler... is sufficient at this
 * scale — no separate job-queue infrastructure is justified yet." Runs
 * once immediately (so a server restart doesn't silently delay reminders
 * by up to 24h) and then every 24h. Returns a stop function for clean
 * shutdown/tests — callers that don't need one (the real server) can
 * ignore it.
 */
export function startRecoveryKeyReminderScheduler(
  ownerDb: Db,
  emailSender: EmailSender,
  appBaseUrl: string,
  logger: ReminderSweepLogger = console,
): () => void {
  const runSweep = () => {
    runRecoveryKeyReminderSweep(ownerDb, emailSender, appBaseUrl, new Date(), logger).catch(
      (error: unknown) => logger.error('Recovery Key reminder sweep failed', error),
    );
  };

  runSweep();
  const interval = setInterval(runSweep, SWEEP_INTERVAL_MS);
  return () => clearInterval(interval);
}

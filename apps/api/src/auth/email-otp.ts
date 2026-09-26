import { createHash, randomInt, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  withEmailLookupContext,
  withOtpEmailLookupContext,
  withTenantContext,
} from '../db/client.js';
import { emailOtpCodes, users } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import type { EmailSender } from '../email/email-sender.js';
import { buildEmailOtpMessage } from '../email/email-otp-email.js';

type Db = PostgresJsDatabase<typeof schema>;

/** `ADR-0018`: a small space by design — the real protection is expiry + attempts + rate limiting, not code-guessing difficulty alone. */
const OTP_CODE_DIGITS = 6;
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_CODE_DIGITS)
    .toString()
    .padStart(OTP_CODE_DIGITS, '0');
}

function hashOtpCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Applied at both entry points below so "Teacher@Example.com" and "teacher@example.com" are always the same account, never a `users.email` uniqueness surprise. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * `ADR-0018` — generates a code, stores only its hash, and emails it via
 * the same `EmailSender` interface `M3-004` built (no second email-sending
 * mechanism). Invalidates any previously-requested, still-outstanding code
 * for this email first — only the most recently requested code is ever
 * valid, so an attempt-count cap can't be diluted by leaving several
 * outstanding rows around from repeated "resend" clicks.
 *
 * Deliberately identical behavior whether or not a `users` row already
 * exists for this email — this function never touches `users` at all, so
 * there's nothing here that could leak "does this email already have an
 * account" to whoever is requesting the code.
 */
export async function requestEmailOtp(
  db: Db,
  emailSender: EmailSender,
  rawEmail: string,
): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

  await withOtpEmailLookupContext(db, email, async (tx) => {
    await tx
      .delete(emailOtpCodes)
      .where(and(eq(emailOtpCodes.email, email), isNull(emailOtpCodes.consumedAt)));
    await tx.insert(emailOtpCodes).values({ email, codeHash, expiresAt });
  });

  await emailSender.send(buildEmailOtpMessage(email, code));
}

export type VerifyEmailOtpResult =
  | { outcome: 'success'; userId: string }
  | { outcome: 'invalid_code' }
  | { outcome: 'expired' }
  | { outcome: 'too_many_attempts' }
  | { outcome: 'wrong_provider' };

/**
 * `ADR-0018` — checks the code against the stored hash, expiry, and
 * attempt cap, and only on success turns the now-proven email into a
 * `users` row (new or existing) and returns its id for the caller
 * (`../routes/auth.ts`) to hand to `createSession` — the exact same
 * session-issuance function the Google OAuth callback already calls, so
 * a session never carries any memory of which provider created it.
 */
export async function verifyEmailOtp(
  db: Db,
  rawEmail: string,
  code: string,
): Promise<VerifyEmailOtpResult> {
  const email = normalizeEmail(rawEmail);
  const codeHash = hashOtpCode(code);
  const now = new Date();

  const rows = await withOtpEmailLookupContext(db, email, (tx) =>
    tx
      .select()
      .from(emailOtpCodes)
      .where(and(eq(emailOtpCodes.email, email), isNull(emailOtpCodes.consumedAt))),
  );
  const row = rows[0];

  if (!row) {
    return { outcome: 'invalid_code' };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { outcome: 'expired' };
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return { outcome: 'too_many_attempts' };
  }
  if (row.codeHash !== codeHash) {
    await withOtpEmailLookupContext(db, email, (tx) =>
      tx
        .update(emailOtpCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(emailOtpCodes.id, row.id)),
    );
    return { outcome: 'invalid_code' };
  }

  await withOtpEmailLookupContext(db, email, (tx) =>
    tx.update(emailOtpCodes).set({ consumedAt: now }).where(eq(emailOtpCodes.id, row.id)),
  );

  return findOrCreateUserByEmail(db, email);
}

/**
 * Only ever called after a code has just been successfully verified —
 * this function itself does not re-check anything about the code. If an
 * account already exists for this email under a *different* provider
 * (e.g. they already have a Google-authenticated account), this
 * deliberately does not log them into it or create a second row — that
 * would be an account-linking operation, out of scope per `ADR-0018`'s
 * own "not built now" note. Safe to reveal which provider owns the email
 * at this point specifically because the caller just proved they control
 * that inbox (verified a code sent to it) — this is helpful, not an
 * enumeration leak.
 */
async function findOrCreateUserByEmail(db: Db, email: string): Promise<VerifyEmailOtpResult> {
  const existingRows = await withEmailLookupContext(db, email, (tx) =>
    tx
      .select({ id: users.id, authProvider: users.authProvider })
      .from(users)
      .where(eq(users.email, email)),
  );
  const existing = existingRows[0];

  if (existing) {
    if (existing.authProvider !== 'email_otp') {
      return { outcome: 'wrong_provider' };
    }
    return { outcome: 'success', userId: existing.id };
  }

  const newUserId = randomUUID();
  await withTenantContext(db, newUserId, (tx) =>
    tx.insert(users).values({
      id: newUserId,
      email,
      authMode: 'local_only',
      authProvider: 'email_otp',
    }),
  );
  return { outcome: 'success', userId: newUserId };
}

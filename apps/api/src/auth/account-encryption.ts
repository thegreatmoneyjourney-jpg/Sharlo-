import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { withTenantContext } from '../db/client.js';
import { users } from '../db/schema.js';
import type * as schema from '../db/schema.js';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * `M3-003`/ADR-0005 — this module only ever stores or returns ciphertext,
 * hex strings, and a KDF-params object it never interprets. Nothing here
 * derives a key, wraps, or unwraps anything: that logic lives entirely in
 * `apps/web/lib/crypto/`, runs in the teacher's own browser, and its
 * output is what this module persists. `kdfParams` is typed `unknown` on
 * purpose (not imported from the web app's `Argon2idParams`, a different
 * workspace package this API deliberately doesn't depend on) — the route
 * layer validates its shape with Zod before it ever reaches here, and this
 * module just stores whatever passed that check.
 */

export interface EncryptionParams {
  wrappedMasterKeyByPassphrase: string;
  wrappedMasterKeyByRecovery: string;
  kdfSalt: string;
  kdfParams: unknown;
  recoveryKeyVerifier: string;
}

/** `null` means this account hasn't completed encryption setup yet (a brand-new sign-in). */
export async function getEncryptionParams(
  db: Db,
  userId: string,
): Promise<EncryptionParams | null> {
  const rows = await withTenantContext(db, userId, (tx) =>
    tx
      .select({
        wrappedMasterKeyByPassphrase: users.wrappedMasterKeyByPassphrase,
        wrappedMasterKeyByRecovery: users.wrappedMasterKeyByRecovery,
        kdfSalt: users.kdfSalt,
        kdfParams: users.kdfParams,
        recoveryKeyVerifier: users.recoveryKeyVerifier,
      })
      .from(users)
      .where(eq(users.id, userId)),
  );
  const row = rows[0];
  // The four fields below are always written together (setupAccountEncryption
  // is their only writer) — a non-null passphrase wrap implies all four are set.
  if (!row?.wrappedMasterKeyByPassphrase) {
    return null;
  }
  return {
    wrappedMasterKeyByPassphrase: row.wrappedMasterKeyByPassphrase,
    wrappedMasterKeyByRecovery: row.wrappedMasterKeyByRecovery!,
    kdfSalt: row.kdfSalt!,
    kdfParams: row.kdfParams,
    recoveryKeyVerifier: row.recoveryKeyVerifier!,
  };
}

export class EncryptionAlreadySetUpError extends Error {
  constructor() {
    super('Encryption is already set up for this account');
    this.name = 'EncryptionAlreadySetUpError';
  }
}

export class EncryptionNotSetUpError extends Error {
  constructor() {
    super('Encryption has not been set up for this account yet');
    this.name = 'EncryptionNotSetUpError';
  }
}

export interface SetupEncryptionInput {
  wrappedMasterKeyByPassphrase: string;
  wrappedMasterKeyByRecovery: string;
  kdfSalt: string;
  kdfParams: unknown;
  recoveryKeyVerifier: string;
}

/**
 * FR-AUTH-03/04/05: first-time signup only. Throws `EncryptionAlreadySetUpError`
 * if the account already has wrapped key material — this must be a
 * one-time operation. Silently overwriting it would generate a mismatch
 * between "the master key this account's data was actually encrypted
 * under" and "the master key this row now claims to be wrapping," which
 * has no recovery path: it would look identical to data corruption to
 * every future unwrap attempt. The existence check and the write happen
 * in the same transaction so a concurrent double-submit can't race past it.
 */
export async function setupAccountEncryption(
  db: Db,
  userId: string,
  input: SetupEncryptionInput,
): Promise<void> {
  await withTenantContext(db, userId, async (tx) => {
    const existing = await tx
      .select({ wrappedMasterKeyByPassphrase: users.wrappedMasterKeyByPassphrase })
      .from(users)
      .where(eq(users.id, userId));
    if (existing[0]?.wrappedMasterKeyByPassphrase) {
      throw new EncryptionAlreadySetUpError();
    }
    await tx
      .update(users)
      .set({
        wrappedMasterKeyByPassphrase: input.wrappedMasterKeyByPassphrase,
        wrappedMasterKeyByRecovery: input.wrappedMasterKeyByRecovery,
        kdfSalt: input.kdfSalt,
        kdfParams: input.kdfParams,
        recoveryKeyVerifier: input.recoveryKeyVerifier,
        recoveryKeyIssuedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });
}

/** ADR-0005 addendum / FR-AUTH-09 — the in-app banner's own trigger, mirrored from `../scheduler/recovery-key-reminders.ts`'s sweep condition so both read the same rule. */
const RECOVERY_KEY_REMINDER_BANNER_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export interface RecoveryKeyReminderStatus {
  showBanner: boolean;
}

/**
 * FR-AUTH-09: the in-app banner shows once 7 days have passed since the
 * Recovery Key was issued, unless the teacher has since actively
 * re-confirmed (`rotateRecoveryKey`, which sets `recoveryKeyReminderDismissedAt`).
 * A brand-new account with no `recoveryKeyIssuedAt` yet never shows it —
 * there's no Recovery Key to be reminded about until setup completes.
 */
export async function getRecoveryKeyReminderStatus(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<RecoveryKeyReminderStatus> {
  const rows = await withTenantContext(db, userId, (tx) =>
    tx
      .select({
        recoveryKeyIssuedAt: users.recoveryKeyIssuedAt,
        recoveryKeyReminderDismissedAt: users.recoveryKeyReminderDismissedAt,
      })
      .from(users)
      .where(eq(users.id, userId)),
  );
  const row = rows[0];
  if (!row?.recoveryKeyIssuedAt || row.recoveryKeyReminderDismissedAt) {
    return { showBanner: false };
  }
  const elapsedMs = now.getTime() - row.recoveryKeyIssuedAt.getTime();
  return { showBanner: elapsedMs >= RECOVERY_KEY_REMINDER_BANNER_THRESHOLD_MS };
}

export interface RotateRecoveryKeyInput {
  wrappedMasterKeyByRecovery: string;
  recoveryKeyVerifier: string;
}

/**
 * The founder-required re-confirmation action (ADR-0005 addendum: "re-
 * download the Recovery Key + click 'I've securely stored this'"). Since
 * neither the server nor the client ever retains the *original* raw
 * Recovery Key after initial wrapping, "re-confirm the same key" isn't
 * literally possible — this issues a brand-new one instead (the actual
 * wrap/generation happens client-side, `apps/web/lib/crypto/master-key.ts`'s
 * `rewrapMasterKeyByNewRecoveryKey`; this function only persists the
 * result). Sets `recoveryKeyReminderDismissedAt` — per the ADR addendum's
 * own wording, an explicit re-confirmation stops reminders outright,
 * matching FR-AUTH-09's acceptance criterion ("no more after an explicit
 * re-confirmation action") literally; it does not restart the 7-/30-day
 * clock for a hypothetical future cycle, since neither the SRS nor the
 * ADR describes one. Throws `EncryptionNotSetUpError` if called before
 * initial setup, same as `changeAccountPassphrase` — there is no Recovery
 * Key yet to rotate.
 */
export async function rotateRecoveryKey(
  db: Db,
  userId: string,
  input: RotateRecoveryKeyInput,
): Promise<void> {
  await withTenantContext(db, userId, async (tx) => {
    const existing = await tx
      .select({ wrappedMasterKeyByPassphrase: users.wrappedMasterKeyByPassphrase })
      .from(users)
      .where(eq(users.id, userId));
    if (!existing[0]?.wrappedMasterKeyByPassphrase) {
      throw new EncryptionNotSetUpError();
    }
    await tx
      .update(users)
      .set({
        wrappedMasterKeyByRecovery: input.wrappedMasterKeyByRecovery,
        recoveryKeyVerifier: input.recoveryKeyVerifier,
        recoveryKeyReminderDismissedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });
}

export interface ChangePassphraseInput {
  wrappedMasterKeyByPassphrase: string;
  kdfSalt: string;
  kdfParams: unknown;
}

/**
 * FR-AUTH-07: "changing the passphrase only re-wraps the master key."
 * Updates *only* the 3 passphrase-path fields — `wrappedMasterKeyByRecovery`,
 * `recoveryKeyVerifier`, and `recoveryKeyIssuedAt` are deliberately absent
 * from the `set()` below, not just left at their current value by
 * coincidence. Throws `EncryptionNotSetUpError` if called before initial
 * setup — there is nothing to re-wrap yet.
 */
export async function changeAccountPassphrase(
  db: Db,
  userId: string,
  input: ChangePassphraseInput,
): Promise<void> {
  await withTenantContext(db, userId, async (tx) => {
    const existing = await tx
      .select({ wrappedMasterKeyByPassphrase: users.wrappedMasterKeyByPassphrase })
      .from(users)
      .where(eq(users.id, userId));
    if (!existing[0]?.wrappedMasterKeyByPassphrase) {
      throw new EncryptionNotSetUpError();
    }
    await tx
      .update(users)
      .set({
        wrappedMasterKeyByPassphrase: input.wrappedMasterKeyByPassphrase,
        kdfSalt: input.kdfSalt,
        kdfParams: input.kdfParams,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });
}

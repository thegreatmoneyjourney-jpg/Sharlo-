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

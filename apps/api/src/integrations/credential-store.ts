import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { integrationCredentials } from '../db/schema.js';
import type * as schema from '../db/schema.js';

/**
 * ADR-0017: every third-party integration secret (Resend, Paddle, Bank
 * Alfalah, the ADR-0016 AI provider, Google OAuth's client secret, any
 * future one) is encrypted at rest in `integration_credentials`, never a
 * plaintext env var that'd need a redeploy to rotate.
 *
 * The *one* secret this deliberately doesn't apply to is `INTEGRATION_CREDENTIALS_KEY`
 * itself — the envelope key that protects every row in that table. It has
 * to live somewhere the process can read at boot before any DB-stored
 * value means anything, so it's the one env var in this whole subsystem,
 * exactly the standard envelope-encryption shape (a key-encrypting-key
 * outside the thing it protects) — not a loophole in the ADR's goal, which
 * is about *rotatable, per-integration* secrets changing without a
 * redeploy. Rotating this key is a deliberate, rare, whole-table
 * re-encryption operation, not a day-to-day credential swap.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // NIST-recommended IV length for GCM
const AUTH_TAG_LENGTH_BYTES = 16;

function loadEncryptionKey(): Buffer {
  const raw = process.env.INTEGRATION_CREDENTIALS_KEY;
  if (!raw) {
    throw new Error(
      'INTEGRATION_CREDENTIALS_KEY is not set — required to read or write integration_credentials. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `INTEGRATION_CREDENTIALS_KEY must decode to exactly 32 bytes for AES-256-GCM, got ${key.length}.`,
    );
  }
  return key;
}

/**
 * Stored layout: `iv (12 bytes) || authTag (16 bytes) || ciphertext`, all
 * in one Buffer — simplest single-column encoding, no second column needed
 * to carry the IV/tag alongside the ciphertext.
 */
export function encryptCredentialValue(plaintext: string): Buffer {
  const key = loadEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptCredentialValue(stored: Buffer): string {
  const key = loadEncryptionKey();
  const iv = stored.subarray(0, IV_LENGTH_BYTES);
  const authTag = stored.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = stored.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Reads and decrypts one credential. Throws (never returns undefined/empty)
 * when the value isn't configured — every call site needs this value to do
 * its job at all (send an email, exchange an OAuth code), so a silent
 * empty-string fallback would only turn a clear startup error into a
 * confusing runtime failure somewhere else.
 */
export async function getCredential(db: Db, provider: string, keyName: string): Promise<string> {
  const rows = await db
    .select({ encryptedValue: integrationCredentials.encryptedValue })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.provider, provider),
        eq(integrationCredentials.keyName, keyName),
      ),
    );
  const row = rows[0];
  if (!row) {
    throw new Error(
      `No integration credential stored for provider="${provider}" keyName="${keyName}".`,
    );
  }
  return decryptCredentialValue(row.encryptedValue);
}

/**
 * Encrypts and upserts one credential. `updatedBy` is nullable — a
 * bootstrap/CLI write (`set-credential.ts`, this task's "minimal write
 * path") has no acting admin session; `M5-012`'s admin UI passes a real
 * admin user id once it exists.
 */
export async function setCredential(
  db: Db,
  provider: string,
  keyName: string,
  value: string,
  updatedBy?: string,
): Promise<void> {
  const encryptedValue = encryptCredentialValue(value);
  await db
    .insert(integrationCredentials)
    .values({ provider, keyName, encryptedValue, updatedBy })
    .onConflictDoUpdate({
      target: [integrationCredentials.provider, integrationCredentials.keyName],
      set: { encryptedValue, updatedBy, updatedAt: new Date() },
    });
}

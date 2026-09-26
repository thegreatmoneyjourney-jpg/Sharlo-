import type { FastifyInstance } from 'fastify';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import type * as schema from '../db/schema.js';
import { requireSession } from '../auth/request-session.js';
import {
  changeAccountPassphrase,
  EncryptionAlreadySetUpError,
  EncryptionNotSetUpError,
  getEncryptionParams,
  setupAccountEncryption,
} from '../auth/account-encryption.js';

type Db = PostgresJsDatabase<typeof schema>;

// Every wrapped-key blob and salt this API ever sees is a hex string
// produced by `apps/web/lib/crypto/encoding.ts` — this is a structural
// validation gate (reject anything that isn't even shaped like ciphertext
// before it reaches the database), not a cryptographic check; the server
// never decodes or interprets these values either way (ADR-0005).
const hexStringSchema = z
  .string()
  .min(1)
  .regex(/^[0-9a-f]+$/i, 'must be a hex-encoded string');

// Loosely shaped and forward-compatible on purpose: `algorithm` isn't
// pinned to the literal `'argon2id'` here, so a future KDF migration
// doesn't require an API redeploy just to accept a new tag — today
// `apps/web/lib/crypto/argon2id.ts` only ever produces `'argon2id'`.
const kdfParamsSchema = z.object({
  algorithm: z.string().min(1),
  opsLimit: z.number().int().positive(),
  memLimit: z.number().int().positive(),
});

const setupBodySchema = z.object({
  wrappedMasterKeyByPassphrase: hexStringSchema,
  wrappedMasterKeyByRecovery: hexStringSchema,
  kdfSalt: hexStringSchema,
  kdfParams: kdfParamsSchema,
  recoveryKeyVerifier: hexStringSchema,
});

const changePassphraseBodySchema = z.object({
  wrappedMasterKeyByPassphrase: hexStringSchema,
  kdfSalt: hexStringSchema,
  kdfParams: kdfParamsSchema,
});

export interface EncryptionRoutesOptions {
  db: Db;
}

/**
 * `M3-003`/ADR-0005 — persists (and returns) only ciphertext, salts, and a
 * KDF-params object; every actual cryptographic operation (key generation,
 * wrapping, unwrapping) happens in the teacher's browser, in
 * `apps/web/lib/crypto/`. All three routes are session-authenticated via
 * `requireSession` and — being non-safe (`POST`)/session-bearing requests
 * — the two mutating ones are covered by the global CSRF double-submit
 * hook (`../auth/csrf-protection.ts`) already registered in `app.ts`; no
 * extra wiring needed here for that.
 */
export async function encryptionRoutes(
  app: FastifyInstance,
  opts: EncryptionRoutesOptions,
): Promise<void> {
  const { db } = opts;

  // Read-only: used both by the settings page (to decide "show the setup
  // flow" vs "show change-passphrase") and, eventually, by a login-time
  // unwrap. `hasEncryptionSetup: false` with no other fields is the
  // expected shape for a brand-new sign-in, not an error.
  app.get('/account/encryption-params', async (req, reply) => {
    const session = await requireSession(req, reply, db);
    if (!session) return;

    const params = await getEncryptionParams(db, session.userId);
    if (!params) {
      return reply.code(200).send({ hasEncryptionSetup: false });
    }
    return reply.code(200).send({ hasEncryptionSetup: true, ...params });
  });

  app.post('/account/encryption-setup', async (req, reply) => {
    const session = await requireSession(req, reply, db);
    if (!session) return;

    const parsed = setupBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }

    try {
      await setupAccountEncryption(db, session.userId, parsed.data);
    } catch (error) {
      if (error instanceof EncryptionAlreadySetUpError) {
        return reply.code(409).send({ error: 'encryption_already_set_up' });
      }
      throw error;
    }
    return reply.code(204).send();
  });

  app.post('/account/encryption-passphrase', async (req, reply) => {
    const session = await requireSession(req, reply, db);
    if (!session) return;

    const parsed = changePassphraseBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }

    try {
      await changeAccountPassphrase(db, session.userId, parsed.data);
    } catch (error) {
      if (error instanceof EncryptionNotSetUpError) {
        return reply.code(409).send({ error: 'encryption_not_set_up' });
      }
      throw error;
    }
    return reply.code(204).send();
  });
}

import { bytesToHex, hexToBytes, type Bytes } from '../crypto/encoding';
import { aesGcmDecrypt, aesGcmEncrypt } from '../crypto/aes-gcm';
import type { StoredEnvelope } from './local-envelope-store';

/**
 * `M3-006` — the authoritative resolution of the envelope-encoding
 * question `M3-005` flagged: `ARCHITECTURE.md` §7's illustrative JSON
 * split the encrypted payload into three fields (`iv`/`ciphertext`/
 * `authTag`). That was never implemented and is now superseded — this
 * module reuses `../crypto/aes-gcm.ts`'s already-tested primitives
 * as-is, which produce/consume a single combined blob
 * (`iv || ciphertext+authTag` — WebCrypto appends the auth tag
 * automatically), hex-encoded into one `ciphertext` field, matching
 * every other encoded byte value in `lib/crypto/` (`encoding.ts`'s own
 * "no padding, no URL-unsafe characters, simplest round-trip" reasoning
 * applies just as much here as to a wrapped master key). Introducing a
 * second encoding convention split across three fields would only add
 * code for the sake of matching an illustration nothing else depends on.
 * `ARCHITECTURE.md` §7 is updated to match this, not left disagreeing
 * with it — see `docs/reports/SHARLO-M3-006.md`.
 *
 * Deliberately separate from `local-envelope-store.ts`/`drive-envelope-store.ts`:
 * this module only ever handles ciphertext and a raw master key already
 * held in memory (never a wrapping key, a passphrase, or a Recovery Key)
 * — it has no idea whether the resulting envelope ends up in IndexedDB or
 * Drive, matching this app's "no provider-specific branching downstream"
 * pattern from `M3-005`'s auth work.
 */

const CURRENT_SCHEMA_VERSION = 1;

function encodeJson(content: unknown): Bytes {
  return new Uint8Array(new TextEncoder().encode(JSON.stringify(content)));
}

function decodeJson<T>(bytes: Bytes): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/**
 * Encrypts `content` (any JSON-serializable value) under `masterKey` into
 * a `StoredEnvelope` ready to hand to either storage backend. `recordId`
 * is the caller's to choose, not generated here — re-encrypting the same
 * logical record (e.g. an exam's results after a re-grade) must reuse the
 * same `recordId` so the storage layer overwrites it rather than creating
 * a duplicate; a brand-new record's caller mints a fresh one itself
 * (`crypto.randomUUID()`).
 */
export async function encryptEnvelope(
  masterKey: Bytes,
  type: string,
  recordId: string,
  content: unknown,
): Promise<StoredEnvelope> {
  const blob = await aesGcmEncrypt(masterKey, encodeJson(content));
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    type,
    recordId,
    ciphertext: bytesToHex(blob),
  };
}

/**
 * Decrypts an envelope produced by `encryptEnvelope`. Throws — never
 * returns partial or corrupted output — if `masterKey` is wrong or the
 * envelope was tampered with, the same authenticated-decryption guarantee
 * `aesGcmDecrypt` itself already provides (see that module's own tests
 * for the confirming negative-path assertions).
 */
export async function decryptEnvelope<T>(masterKey: Bytes, envelope: StoredEnvelope): Promise<T> {
  if (typeof envelope.ciphertext !== 'string') {
    throw new Error('Envelope is missing its ciphertext field.');
  }
  const plaintext = await aesGcmDecrypt(masterKey, hexToBytes(envelope.ciphertext));
  return decodeJson<T>(plaintext);
}

/**
 * AES-256-GCM wrap/unwrap via native WebCrypto (`crypto.subtle`) — no
 * third-party library needed for this primitive, since WebCrypto is a
 * browser-vendor-implemented, spec-mandated (W3C Web Cryptography API)
 * primitive, audited by definition of being every major browser's own
 * cryptographic implementation. Per the founder's instruction to use only
 * established, well-audited primitives and never hand-roll cryptographic
 * logic, this file contains zero actual cipher logic — it only calls
 * `crypto.subtle` and moves bytes around.
 */

import type { Bytes } from './encoding';

const AES_GCM_IV_BYTES = 12; // 96-bit IV — the size AES-GCM (NIST SP 800-38D) is designed for; a fresh random one is generated per call and never reused for a given key

async function importAesGcmKey(rawKey: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypts `plaintext` under `rawKey` with a fresh random IV.
 * Output layout: `iv (12 bytes) || ciphertext+authTag`. WebCrypto's
 * AES-GCM appends the authentication tag to the ciphertext output
 * automatically (unlike Node's `node:crypto`, which needs a separate
 * `getAuthTag()` call) — there is nothing further to concatenate.
 */
export async function aesGcmEncrypt(rawKey: Bytes, plaintext: Bytes): Promise<Bytes> {
  const key = await importAesGcmKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  );
  const output = new Uint8Array(iv.length + ciphertext.length);
  output.set(iv, 0);
  output.set(ciphertext, iv.length);
  return output;
}

/**
 * Decrypts a blob produced by `aesGcmEncrypt`. Throws — never returns
 * partial or corrupted output — if `rawKey` is wrong or the blob was
 * tampered with. AES-GCM is an *authenticated* cipher: decryption
 * verifies the authentication tag first and only returns plaintext if it
 * matches; otherwise `crypto.subtle.decrypt` itself rejects. This is the
 * primitive-level guarantee behind this task's negative-path requirement
 * (a wrong passphrase or wrong Recovery Key must fail cleanly, never
 * silently produce garbage) — no additional application-level check is
 * needed on top to get that property; see `master-key.test.ts`'s negative
 * path tests for the confirming assertions, not just an assumption that
 * this holds.
 */
export async function aesGcmDecrypt(rawKey: Bytes, blob: Bytes): Promise<Bytes> {
  if (blob.length <= AES_GCM_IV_BYTES) {
    throw new Error('Ciphertext blob too short to contain an IV and any content');
  }
  const key = await importAesGcmKey(rawKey);
  const iv = blob.slice(0, AES_GCM_IV_BYTES);
  const ciphertext = blob.slice(AES_GCM_IV_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(plaintext);
}

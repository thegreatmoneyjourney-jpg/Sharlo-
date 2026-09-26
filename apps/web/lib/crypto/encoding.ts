/**
 * Hex encode/decode for crypto byte blobs (wrapped-key ciphertext, KDF
 * salts, the Recovery Key's display form). Chosen over base64 for every
 * value in this module deliberately — no padding characters, no
 * URL-unsafe characters, and the simplest possible round-trip to reason
 * about, which matters most for the Recovery Key: a teacher may need to
 * type it back in by hand, and an encoding bug here is a data-loss bug,
 * not a cosmetic one.
 */

/**
 * TypeScript 5.7+ made `Uint8Array` generic over its backing buffer type
 * (defaulting the bare name to `Uint8Array<ArrayBufferLike>`), and the DOM
 * lib's Web Crypto signatures (`BufferSource`) only accept the concrete
 * `Uint8Array<ArrayBuffer>` form. Every byte buffer anywhere in
 * `lib/crypto/` is always backed by a plain `ArrayBuffer` in practice
 * (`crypto.getRandomValues(new Uint8Array(n))`, a `crypto.subtle` result,
 * a fixed-length `new Uint8Array(n)`, ...) — this alias makes that
 * already-true fact visible to the type checker, used everywhere in this
 * directory instead of the bare name.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

const HEX_PATTERN = /^[0-9a-f]+$/i;

export function bytesToHex(bytes: Bytes): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex: string): Bytes {
  if (hex.length === 0 || hex.length % 2 !== 0 || !HEX_PATTERN.test(hex)) {
    throw new Error('Invalid hex string: must be a non-empty, even-length sequence of hex digits');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

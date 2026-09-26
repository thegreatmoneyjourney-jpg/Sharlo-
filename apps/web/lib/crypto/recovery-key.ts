import { bytesToHex, hexToBytes, type Bytes } from './encoding';

/** 256-bit — same size as the master key it wraps directly. No KDF stretch: unlike the passphrase, this is already full-strength random entropy, so running it through Argon2id would add no security benefit, only latency. */
const RECOVERY_KEY_BYTES = 32;
const HEX_GROUP_SIZE = 4;

export function generateRecoveryKey(): Bytes {
  return crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_BYTES));
}

/**
 * e.g. `"a1b2-c3d4-e5f6-..."`. Purely a readability aid for the one-time
 * display/printout — hex was chosen deliberately over base32/base58 for
 * every value this task encodes: no ambiguous characters to misjudge
 * (`0`/`O`, `1`/`l`), no checksum/alphabet edge cases, the simplest
 * possible encoding to get right given how catastrophic an encoding bug
 * would be here (see `master-key.test.ts`'s round-trip tests). Grouping
 * and case are stripped again by `decodeRecoveryKeyFromDisplay`, so
 * exactly how a teacher retypes it doesn't need to match this formatting.
 */
export function encodeRecoveryKeyForDisplay(bytes: Bytes): string {
  const hex = bytesToHex(bytes);
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += HEX_GROUP_SIZE) {
    groups.push(hex.slice(i, i + HEX_GROUP_SIZE));
  }
  return groups.join('-');
}

/**
 * Inverse of `encodeRecoveryKeyForDisplay`. Strips whitespace/hyphens and
 * lower-cases before decoding, so incidental spacing or case from a
 * teacher retyping a printed key doesn't cause a spurious failure. A
 * malformed string (wrong length, non-hex characters) throws clearly —
 * but note a well-formed *wrong* key still decodes successfully to some
 * 32-byte value here; hex decoding can't tell "wrong key" from "right
 * key" by itself. It's `aesGcmDecrypt`'s authentication check downstream,
 * not this function, that's the actual safety net.
 */
export function decodeRecoveryKeyFromDisplay(display: string): Bytes {
  const hex = display.replace(/[\s-]/g, '').toLowerCase();
  const bytes = hexToBytes(hex);
  if (bytes.length !== RECOVERY_KEY_BYTES) {
    throw new Error(`Recovery Key must decode to ${RECOVERY_KEY_BYTES} bytes, got ${bytes.length}`);
  }
  return bytes;
}

/**
 * Fast "does this look right" UX check only — explicitly NOT the security
 * boundary. `docs/ARCHITECTURE.md`'s schema sketch calls this field a
 * "verifier hash, not the key itself" with no further elaboration; the
 * actual safety guarantee against a wrong Recovery Key (fail cleanly,
 * never partially decrypt) comes from AES-GCM's own authenticated-
 * decryption failure in `aes-gcm.ts`, independent of this field. A plain
 * fast hash is sufficient for a UI-level early-warning check (e.g. "this
 * doesn't look like the key we issued you, double-check before
 * continuing"), so this deliberately does not use Argon2id — that would
 * only make every legitimate unwrap slower for no additional security
 * benefit here, since a verifier is inherently checkable by anyone who
 * already holds the ciphertext (it is not, itself, secret-dependent
 * gatekeeping).
 */
export async function computeRecoveryKeyVerifier(bytes: Bytes): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

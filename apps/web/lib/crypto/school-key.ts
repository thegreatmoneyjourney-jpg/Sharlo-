import { bytesToHex, hexToBytes, type Bytes } from './encoding';
import { aesGcmDecrypt, aesGcmEncrypt } from './aes-gcm';
import { generateX25519KeyPair } from './x25519';

/**
 * `M3-014`/`ADR-0010` — School-plan key material, generated once at school
 * creation. Both the school key and the admin's X25519 private key are
 * wrapped under the admin's own *master key* (already unlocked this
 * session via `master-key-session.ts`/`require-master-key.tsx`), not a
 * freshly re-derived passphrase-KEK, and not a second wrap by the raw
 * Recovery Key — see `apps/api/src/db/schema.ts`'s `schools` table doc
 * comment for the full reasoning this deviates from ADR-0010's literal
 * `..._by_admin_passphrase` column name/mechanism, and why: the master key
 * is already the one thing both the admin's passphrase and Recovery Key
 * can unlock, so wrapping under it gives the identical dual-recovery
 * property with one wrap instead of two, and sidesteps the raw Recovery
 * Key never being retained after its one-time initial issuance.
 */

const SCHOOL_KEY_BYTES = 32;

export function generateSchoolKey(): Bytes {
  return crypto.getRandomValues(new Uint8Array(SCHOOL_KEY_BYTES));
}

export interface SchoolKeyMaterial {
  schoolWrappedKeyByAdminMasterKey: string;
  adminX25519PublicKey: string;
  adminX25519WrappedPrivateKey: string;
}

/**
 * Generates a brand-new school key and the admin's X25519 keypair
 * (`M3-015`/`016`'s sealed-box mechanism), wrapping both under `masterKey`.
 * Field names match `schools`' own DB columns exactly — the caller
 * (`POST /schools`) sends this object's fields as-is.
 */
export async function setupSchoolKeyMaterial(masterKey: Bytes): Promise<SchoolKeyMaterial> {
  const schoolKey = generateSchoolKey();
  try {
    const wrappedSchoolKey = await aesGcmEncrypt(masterKey, schoolKey);

    const keyPair = await generateX25519KeyPair();
    try {
      const wrappedPrivateKey = await aesGcmEncrypt(masterKey, keyPair.privateKey);
      return {
        schoolWrappedKeyByAdminMasterKey: bytesToHex(wrappedSchoolKey),
        adminX25519PublicKey: bytesToHex(keyPair.publicKey),
        adminX25519WrappedPrivateKey: bytesToHex(wrappedPrivateKey),
      };
    } finally {
      keyPair.privateKey.fill(0);
    }
  } finally {
    schoolKey.fill(0);
  }
}

/**
 * `M3-017`'s own future need: the principal dashboard decrypts school-key
 * copies of results client-side, which needs the raw school key back.
 * Not called anywhere yet — built now alongside the wrap side of the same
 * primitive, the same "build the complete, tested pair now" precedent
 * `master-key.ts`'s `rewrapMasterKeyByNewRecoveryKey` already set for
 * `M3-004`.
 */
export async function unwrapSchoolKey(
  masterKey: Bytes,
  schoolWrappedKeyByAdminMasterKey: string,
): Promise<Bytes> {
  return aesGcmDecrypt(masterKey, hexToBytes(schoolWrappedKeyByAdminMasterKey));
}

/**
 * `M3-015`/`016`'s own future need: opening a sealed box a teacher sent
 * requires the admin's raw X25519 private key, paired back up with the
 * (already-known, non-secret) public key to form the `X25519KeyPair`
 * `openSealedBox` (`x25519.ts`) needs.
 */
export async function unwrapAdminX25519PrivateKey(
  masterKey: Bytes,
  adminX25519WrappedPrivateKey: string,
): Promise<Bytes> {
  return aesGcmDecrypt(masterKey, hexToBytes(adminX25519WrappedPrivateKey));
}

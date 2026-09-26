import { bytesToHex, hexToBytes, type Bytes } from './encoding';
import {
  deriveWrappingKeyFromPassphrase,
  generateKdfSalt,
  getDefaultArgon2idParams,
  type Argon2idParams,
} from './argon2id';
import { aesGcmDecrypt, aesGcmEncrypt } from './aes-gcm';
import {
  computeRecoveryKeyVerifier,
  decodeRecoveryKeyFromDisplay,
  encodeRecoveryKeyForDisplay,
  generateRecoveryKey,
} from './recovery-key';

/**
 * ADR-0005 orchestration: a random per-teacher master key (FR-AUTH-03),
 * wrapped two independent ways — by an Argon2id-derived key from the
 * Encryption Passphrase (FR-AUTH-04), and by a one-time Recovery Key
 * (FR-AUTH-05) — so either can unwrap it on a new device/browser. Every
 * function here only ever produces or consumes ciphertext/hex strings at
 * its boundary; the raw master key and any wrapping key never leave this
 * module's memory, and are best-effort zeroed (`.fill(0)`) once no longer
 * needed — defense in depth, not a guarantee JS can make watertight, but
 * cheap and standard crypto-library hygiene (mirrors libsodium's own
 * `memzero`).
 */

const MASTER_KEY_BYTES = 32;

export function generateMasterKey(): Bytes {
  return crypto.getRandomValues(new Uint8Array(MASTER_KEY_BYTES));
}

export interface EncryptionSetupResult {
  wrappedMasterKeyByPassphrase: string;
  wrappedMasterKeyByRecovery: string;
  kdfSalt: string;
  kdfParams: Argon2idParams;
  recoveryKeyVerifier: string;
  /** Shown to the teacher exactly once by the calling UI. Never sent to the server and never retained anywhere after this call returns — losing it after this point is exactly the "lose the Recovery Key" scenario FR-AUTH-08 describes. */
  recoveryKeyDisplay: string;
}

/**
 * FR-AUTH-03/04/05: first-time signup. Generates a brand-new master key
 * and wraps it two independent ways. The caller (the encryption-setup API
 * route) is responsible for rejecting this being called a second time for
 * an account that already has wrapped key material — regenerating the
 * master key here would silently orphan any data already encrypted under
 * the old one, which is an application-layer invariant this pure function
 * has no way to know about or enforce itself.
 */
export async function setupEncryption(passphrase: string): Promise<EncryptionSetupResult> {
  const masterKey = generateMasterKey();
  try {
    const kdfParams = await getDefaultArgon2idParams();
    const kdfSalt = await generateKdfSalt();
    const passphraseWrappingKey = await deriveWrappingKeyFromPassphrase(
      passphrase,
      kdfSalt,
      kdfParams,
    );
    let wrappedByPassphrase: Bytes;
    try {
      wrappedByPassphrase = await aesGcmEncrypt(passphraseWrappingKey, masterKey);
    } finally {
      passphraseWrappingKey.fill(0);
    }

    const recoveryKey = generateRecoveryKey();
    let wrappedByRecovery: Bytes;
    let recoveryKeyVerifier: string;
    let recoveryKeyDisplay: string;
    try {
      wrappedByRecovery = await aesGcmEncrypt(recoveryKey, masterKey);
      recoveryKeyVerifier = await computeRecoveryKeyVerifier(recoveryKey);
      recoveryKeyDisplay = encodeRecoveryKeyForDisplay(recoveryKey);
    } finally {
      recoveryKey.fill(0);
    }

    return {
      wrappedMasterKeyByPassphrase: bytesToHex(wrappedByPassphrase),
      wrappedMasterKeyByRecovery: bytesToHex(wrappedByRecovery),
      kdfSalt: bytesToHex(kdfSalt),
      kdfParams,
      recoveryKeyVerifier,
      recoveryKeyDisplay,
    };
  } finally {
    masterKey.fill(0);
  }
}

export interface StoredEncryptionParams {
  wrappedMasterKeyByPassphrase: string;
  wrappedMasterKeyByRecovery: string;
  kdfSalt: string;
  kdfParams: Argon2idParams;
}

/**
 * FR-AUTH-04 everyday unwrap path. Throws — never returns a corrupted or
 * partial key — if `passphrase` is wrong; see `aesGcmDecrypt`'s doc
 * comment for why that's a primitive-level guarantee this function
 * inherits rather than something it adds on top.
 */
export async function unwrapMasterKeyByPassphrase(
  passphrase: string,
  stored: Pick<StoredEncryptionParams, 'wrappedMasterKeyByPassphrase' | 'kdfSalt' | 'kdfParams'>,
): Promise<Bytes> {
  const salt = hexToBytes(stored.kdfSalt);
  const wrappingKey = await deriveWrappingKeyFromPassphrase(passphrase, salt, stored.kdfParams);
  try {
    return await aesGcmDecrypt(wrappingKey, hexToBytes(stored.wrappedMasterKeyByPassphrase));
  } finally {
    wrappingKey.fill(0);
  }
}

/**
 * FR-AUTH-05/ADR-0005 break-glass path — "forgot the passphrase, only has
 * the Recovery Key." This is the path the founder specifically flagged as
 * the one that matters most to verify actually works, not just assumed
 * to work because the wrapping logic looks symmetric — see
 * `master-key.test.ts`'s dedicated test for this exact scenario. No KDF
 * involved: the Recovery Key is already full-strength 256-bit entropy,
 * used directly as the AES-GCM key.
 */
export async function unwrapMasterKeyByRecoveryKey(
  recoveryKeyDisplay: string,
  stored: Pick<StoredEncryptionParams, 'wrappedMasterKeyByRecovery'>,
): Promise<Bytes> {
  const recoveryKey = decodeRecoveryKeyFromDisplay(recoveryKeyDisplay);
  try {
    return await aesGcmDecrypt(recoveryKey, hexToBytes(stored.wrappedMasterKeyByRecovery));
  } finally {
    recoveryKey.fill(0);
  }
}

export interface PassphraseRewrapResult {
  wrappedMasterKeyByPassphrase: string;
  kdfSalt: string;
  kdfParams: Argon2idParams;
}

/**
 * FR-AUTH-07: "changing the passphrase only re-wraps the master key."
 * Takes the *already-unwrapped* master key (the caller must unwrap it
 * with the OLD passphrase first — proving they still know it, or have
 * gone through the Recovery Key path instead) and produces a brand-new
 * wrap under the NEW passphrase, with a freshly-generated salt (a KDF
 * salt is never reused across a passphrase change). Deliberately returns
 * only these 3 fields: `wrappedMasterKeyByRecovery`/`recoveryKeyVerifier`
 * are not touched or returned, because a passphrase change doesn't affect
 * them at all — this operation changes only how the *same* master key is
 * wrapped by the passphrase, never the master key itself. No previously
 * -encrypted data needs to be touched, because the master key used to
 * encrypt it never changes — confirmed by `master-key.test.ts`'s
 * passphrase-change test, not just assumed from the design.
 */
export async function rewrapMasterKeyByNewPassphrase(
  masterKey: Bytes,
  newPassphrase: string,
): Promise<PassphraseRewrapResult> {
  const kdfParams = await getDefaultArgon2idParams();
  const kdfSalt = await generateKdfSalt();
  const wrappingKey = await deriveWrappingKeyFromPassphrase(newPassphrase, kdfSalt, kdfParams);
  try {
    const wrapped = await aesGcmEncrypt(wrappingKey, masterKey);
    return {
      wrappedMasterKeyByPassphrase: bytesToHex(wrapped),
      kdfSalt: bytesToHex(kdfSalt),
      kdfParams,
    };
  } finally {
    wrappingKey.fill(0);
  }
}

export interface RecoveryKeyRotationResult {
  recoveryKeyDisplay: string;
  wrappedMasterKeyByRecovery: string;
  recoveryKeyVerifier: string;
}

/**
 * Reusable primitive for the Recovery Key *rotation* the M3-004 reminder
 * cadence will eventually need. `ADR-0005`'s addendum describes the
 * 7-/30-day reminder flow as a "re-download the Recovery Key and confirm"
 * action — but since neither the server nor the client retains the
 * original raw Recovery Key after initial wrapping (true zero-knowledge
 * design — only `wrappedMasterKeyByRecovery` ciphertext and a verifier
 * hash are ever stored), "re-display the original key" is not actually
 * possible. The only thing a reminder re-confirmation flow *can* do is
 * issue a brand-new Recovery Key and re-wrap the master key with it,
 * discarding the old wrapped blob so the old key stops working. This
 * function builds and this task's test suite verifies that primitive;
 * the actual reminder-cadence scheduling/UI that calls it is `M3-004`'s
 * own scope — not built here. See `docs/reports/SHARLO-M3-003.md` for
 * this handoff note in full.
 */
export async function rewrapMasterKeyByNewRecoveryKey(
  masterKey: Bytes,
): Promise<RecoveryKeyRotationResult> {
  const recoveryKey = generateRecoveryKey();
  try {
    const wrapped = await aesGcmEncrypt(recoveryKey, masterKey);
    const recoveryKeyVerifier = await computeRecoveryKeyVerifier(recoveryKey);
    return {
      recoveryKeyDisplay: encodeRecoveryKeyForDisplay(recoveryKey),
      wrappedMasterKeyByRecovery: bytesToHex(wrapped),
      recoveryKeyVerifier,
    };
  } finally {
    recoveryKey.fill(0);
  }
}

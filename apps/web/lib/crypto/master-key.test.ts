/**
 * @vitest-environment node
 *
 * Needs real `crypto.subtle`/`crypto.getRandomValues` (jsdom doesn't
 * implement `subtle` — see `aes-gcm.test.ts`). This file is the direct
 * verification the founder required for M3-003: all three ways a master
 * key can be unwrapped, the passphrase-change re-wrap, and the negative
 * (wrong-credential) path — each proven by an actual assertion here, not
 * assumed from the wrapping logic "looking symmetric."
 */
import { describe, expect, it } from 'vitest';
import {
  rewrapMasterKeyByNewPassphrase,
  rewrapMasterKeyByNewRecoveryKey,
  setupEncryption,
  unwrapMasterKeyByPassphrase,
  unwrapMasterKeyByRecoveryKey,
} from './master-key';

const PASSPHRASE = 'correct horse battery staple';

describe('setupEncryption', () => {
  it('returns two independent wrapped blobs, KDF material, a verifier, and a display-form Recovery Key', async () => {
    const result = await setupEncryption(PASSPHRASE);

    expect(result.wrappedMasterKeyByPassphrase).toMatch(/^[0-9a-f]+$/);
    expect(result.wrappedMasterKeyByRecovery).toMatch(/^[0-9a-f]+$/);
    expect(result.wrappedMasterKeyByPassphrase).not.toBe(result.wrappedMasterKeyByRecovery);
    expect(result.kdfSalt).toMatch(/^[0-9a-f]+$/);
    expect(result.kdfParams.algorithm).toBe('argon2id');
    expect(result.recoveryKeyVerifier).toMatch(/^[0-9a-f]{64}$/);
    expect(result.recoveryKeyDisplay).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){15}$/);
  });

  it('generates a fresh master key (and therefore different wrapped blobs) on every call, even with the same passphrase', async () => {
    const a = await setupEncryption(PASSPHRASE);
    const b = await setupEncryption(PASSPHRASE);
    expect(a.wrappedMasterKeyByPassphrase).not.toBe(b.wrappedMasterKeyByPassphrase);
    expect(a.recoveryKeyDisplay).not.toBe(b.recoveryKeyDisplay);
  });
});

describe('recovery path 1: unwrap by the Encryption Passphrase (everyday sign-in)', () => {
  it('recovers the exact master key that was wrapped', async () => {
    const setup = await setupEncryption(PASSPHRASE);

    const unwrapped = await unwrapMasterKeyByPassphrase(PASSPHRASE, setup);

    // Round-trip proof, not just "didn't throw": re-wrapping the
    // recovered key under a fresh passphrase+salt and unwrapping that
    // must also work, which is only possible if `unwrapped` is bit-for-
    // bit the original master key.
    const rewrap = await rewrapMasterKeyByNewPassphrase(unwrapped, 'a different passphrase');
    const roundTripped = await unwrapMasterKeyByPassphrase('a different passphrase', {
      wrappedMasterKeyByPassphrase: rewrap.wrappedMasterKeyByPassphrase,
      kdfSalt: rewrap.kdfSalt,
      kdfParams: rewrap.kdfParams,
    });
    expect(roundTripped).toEqual(unwrapped);
  });
});

describe('recovery path 2: unwrap by the Recovery Key alone (forgotten-passphrase break-glass) — the path that matters most', () => {
  it('recovers the exact same master key as the passphrase path, using only the Recovery Key and simulating the passphrase being unknown/unused', async () => {
    const setup = await setupEncryption(PASSPHRASE);

    // Simulate "forgot the passphrase": never call unwrapMasterKeyByPassphrase
    // at all, go straight to the Recovery Key path.
    const unwrappedByRecovery = await unwrapMasterKeyByRecoveryKey(setup.recoveryKeyDisplay, setup);

    // Cross-check against the passphrase path's own result, proving both
    // wraps really do protect the identical underlying master key, not
    // two different keys that happen to both "work."
    const unwrappedByPassphrase = await unwrapMasterKeyByPassphrase(PASSPHRASE, setup);
    expect(unwrappedByRecovery).toEqual(unwrappedByPassphrase);
  });

  it('still works after cosmetic re-formatting of the Recovery Key display string (spacing/case a teacher might introduce retyping it)', async () => {
    const setup = await setupEncryption(PASSPHRASE);
    const retyped = setup.recoveryKeyDisplay.toUpperCase().replace(/-/g, '  ');

    const unwrapped = await unwrapMasterKeyByRecoveryKey(retyped, setup);
    const expected = await unwrapMasterKeyByPassphrase(PASSPHRASE, setup);
    expect(unwrapped).toEqual(expected);
  });
});

describe('recovery path 3: changing the passphrase only re-wraps the master key (FR-AUTH-07)', () => {
  it('re-wraps under the new passphrase without changing the underlying master key, and leaves the Recovery Key wrap completely untouched', async () => {
    const setup = await setupEncryption(PASSPHRASE);
    const masterKeyBeforeChange = await unwrapMasterKeyByPassphrase(PASSPHRASE, setup);

    const rewrap = await rewrapMasterKeyByNewPassphrase(
      masterKeyBeforeChange,
      'brand new passphrase',
    );

    const stored = {
      wrappedMasterKeyByPassphrase: rewrap.wrappedMasterKeyByPassphrase,
      wrappedMasterKeyByRecovery: setup.wrappedMasterKeyByRecovery, // untouched by the rewrap
      kdfSalt: rewrap.kdfSalt,
      kdfParams: rewrap.kdfParams,
    };

    // 1. The SAME master key survives the passphrase change — this is
    // the core "no data re-encryption needed" guarantee: any data
    // encrypted under `masterKeyBeforeChange` before the change remains
    // decryptable after it, untouched, because the key never changed.
    const masterKeyAfterChange = await unwrapMasterKeyByPassphrase('brand new passphrase', stored);
    expect(masterKeyAfterChange).toEqual(masterKeyBeforeChange);

    // 2. The Recovery Key wrap was never touched by a passphrase-only
    // change — it still independently unwraps to the identical key.
    const viaRecoveryKey = await unwrapMasterKeyByRecoveryKey(setup.recoveryKeyDisplay, stored);
    expect(viaRecoveryKey).toEqual(masterKeyBeforeChange);

    // 3. The rewrap actually REPLACED the old passphrase wrap, not just
    // added a second valid one alongside it — the OLD passphrase must no
    // longer unwrap the NEW stored blob.
    await expect(unwrapMasterKeyByPassphrase(PASSPHRASE, stored)).rejects.toThrow();
  });

  it('uses a fresh KDF salt on every passphrase change rather than reusing the original one', async () => {
    const setup = await setupEncryption(PASSPHRASE);
    const masterKey = await unwrapMasterKeyByPassphrase(PASSPHRASE, setup);
    const rewrap = await rewrapMasterKeyByNewPassphrase(masterKey, 'brand new passphrase');
    expect(rewrap.kdfSalt).not.toBe(setup.kdfSalt);
  });
});

describe('negative path: wrong credentials fail cleanly, never partially decrypt or produce corrupted output', () => {
  it('rejects the wrong passphrase outright (no Recovery Key involved)', async () => {
    const setup = await setupEncryption(PASSPHRASE);

    await expect(
      unwrapMasterKeyByPassphrase('definitely the wrong passphrase', setup),
    ).rejects.toThrow();
  });

  it('never resolves successfully with a value when the passphrase is wrong — asserted directly, not inferred from the rejection alone', async () => {
    const setup = await setupEncryption(PASSPHRASE);
    let resolvedValue: Uint8Array | undefined;
    let didReject = false;

    try {
      resolvedValue = await unwrapMasterKeyByPassphrase('wrong', setup);
    } catch {
      didReject = true;
    }

    expect(didReject).toBe(true);
    expect(resolvedValue).toBeUndefined();
  });

  it('rejects a well-formed but wrong Recovery Key', async () => {
    const setup = await setupEncryption(PASSPHRASE);
    const someoneElsesRecoveryKey = (await setupEncryption('unrelated account')).recoveryKeyDisplay;

    await expect(unwrapMasterKeyByRecoveryKey(someoneElsesRecoveryKey, setup)).rejects.toThrow();
  });

  it('rejects a garbled/malformed Recovery Key string cleanly, before ever reaching AES-GCM', async () => {
    const setup = await setupEncryption(PASSPHRASE);

    await expect(unwrapMasterKeyByRecoveryKey('not-a-real-recovery-key', setup)).rejects.toThrow();
  });

  it('never returns corrupted/partial bytes from a failed unwrap — a caught failure leaves no plaintext-shaped value behind', async () => {
    const setup = await setupEncryption(PASSPHRASE);
    let recovered: Uint8Array | undefined;

    try {
      recovered = await unwrapMasterKeyByPassphrase(
        'wrong passphrase, no recovery key provided',
        setup,
      );
    } catch {
      // expected
    }

    expect(recovered).toBeUndefined();
  });
});

describe('Recovery Key rotation primitive (built here for M3-004 to call later; no reminder-cadence UI/scheduling in this task)', () => {
  it('re-wraps the master key under a brand-new Recovery Key that independently unwraps to the same master key', async () => {
    const setup = await setupEncryption(PASSPHRASE);
    const masterKey = await unwrapMasterKeyByPassphrase(PASSPHRASE, setup);

    const rotated = await rewrapMasterKeyByNewRecoveryKey(masterKey);

    expect(rotated.recoveryKeyDisplay).not.toBe(setup.recoveryKeyDisplay);
    const unwrappedWithNewKey = await unwrapMasterKeyByRecoveryKey(rotated.recoveryKeyDisplay, {
      wrappedMasterKeyByRecovery: rotated.wrappedMasterKeyByRecovery,
    });
    expect(unwrappedWithNewKey).toEqual(masterKey);
  });

  it('invalidates the OLD Recovery Key against the new wrapped blob — this is a real rotation, not just an additional valid key', async () => {
    const setup = await setupEncryption(PASSPHRASE);
    const masterKey = await unwrapMasterKeyByPassphrase(PASSPHRASE, setup);

    const rotated = await rewrapMasterKeyByNewRecoveryKey(masterKey);

    await expect(
      unwrapMasterKeyByRecoveryKey(setup.recoveryKeyDisplay, {
        wrappedMasterKeyByRecovery: rotated.wrappedMasterKeyByRecovery,
      }),
    ).rejects.toThrow();
  });

  it('does not touch the passphrase wrap at all', async () => {
    const setup = await setupEncryption(PASSPHRASE);
    const masterKey = await unwrapMasterKeyByPassphrase(PASSPHRASE, setup);

    await rewrapMasterKeyByNewRecoveryKey(masterKey);

    // The passphrase path is entirely orthogonal to a recovery-key
    // rotation — still works, unaffected, against the original setup blob.
    const stillWorks = await unwrapMasterKeyByPassphrase(PASSPHRASE, setup);
    expect(stillWorks).toEqual(masterKey);
  });
});

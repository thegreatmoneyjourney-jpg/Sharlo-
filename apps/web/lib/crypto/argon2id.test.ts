/**
 * @vitest-environment node
 *
 * Not strictly required by libsodium-wrappers-sumo itself (it runs in
 * both Node and the browser), but kept consistent with the rest of
 * `lib/crypto/`'s test files, none of which touch the DOM.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveWrappingKeyFromPassphrase,
  generateKdfSalt,
  getDefaultArgon2idParams,
  resetArgon2idLoaderForTests,
} from './argon2id';

afterEach(() => {
  resetArgon2idLoaderForTests();
});

describe('getDefaultArgon2idParams', () => {
  it('returns the argon2id algorithm tag with positive cost parameters', async () => {
    const params = await getDefaultArgon2idParams();
    expect(params.algorithm).toBe('argon2id');
    expect(params.opsLimit).toBeGreaterThan(0);
    expect(params.memLimit).toBeGreaterThan(0);
  });

  it("returns the MODERATE tier, not SENSITIVE — see this module's own doc comment for why", async () => {
    // Reach into a fresh sodium instance directly to compare against the
    // library's own named constants, rather than hardcoding numbers here.
    const sodium = (await import('libsodium-wrappers-sumo')).default;
    await sodium.ready;
    const params = await getDefaultArgon2idParams();
    expect(params.opsLimit).toBe(sodium.crypto_pwhash_argon2id_OPSLIMIT_MODERATE);
    expect(params.memLimit).toBe(sodium.crypto_pwhash_argon2id_MEMLIMIT_MODERATE);
    expect(params.opsLimit).not.toBe(sodium.crypto_pwhash_argon2id_OPSLIMIT_SENSITIVE);
    expect(params.memLimit).not.toBe(sodium.crypto_pwhash_argon2id_MEMLIMIT_SENSITIVE);
  });
});

describe('generateKdfSalt', () => {
  it('generates a different salt every call', async () => {
    const a = await generateKdfSalt();
    const b = await generateKdfSalt();
    expect(a).not.toEqual(b);
  });
});

describe('deriveWrappingKeyFromPassphrase', () => {
  it('derives a 32-byte key', async () => {
    const params = await getDefaultArgon2idParams();
    const salt = await generateKdfSalt();
    const key = await deriveWrappingKeyFromPassphrase('correct horse battery staple', salt, params);
    expect(key).toHaveLength(32);
  });

  it('is deterministic for the same passphrase, salt, and params', async () => {
    const params = await getDefaultArgon2idParams();
    const salt = await generateKdfSalt();
    const keyA = await deriveWrappingKeyFromPassphrase('same passphrase', salt, params);
    const keyB = await deriveWrappingKeyFromPassphrase('same passphrase', salt, params);
    expect(keyA).toEqual(keyB);
  });

  it('derives a different key for a different passphrase, same salt', async () => {
    const params = await getDefaultArgon2idParams();
    const salt = await generateKdfSalt();
    const keyA = await deriveWrappingKeyFromPassphrase('passphrase one', salt, params);
    const keyB = await deriveWrappingKeyFromPassphrase('passphrase two', salt, params);
    expect(keyA).not.toEqual(keyB);
  });

  it('derives a different key for a different salt, same passphrase', async () => {
    const params = await getDefaultArgon2idParams();
    const saltA = await generateKdfSalt();
    const saltB = await generateKdfSalt();
    const keyA = await deriveWrappingKeyFromPassphrase('same passphrase', saltA, params);
    const keyB = await deriveWrappingKeyFromPassphrase('same passphrase', saltB, params);
    expect(keyA).not.toEqual(keyB);
  });

  it('rejects an unsupported KDF algorithm tag rather than silently deriving with the wrong function', async () => {
    const salt = await generateKdfSalt();
    await expect(
      deriveWrappingKeyFromPassphrase('x', salt, {
        algorithm: 'argon2i' as 'argon2id',
        opsLimit: 3,
        memLimit: 1024,
      }),
    ).rejects.toThrow(/Unsupported KDF algorithm/);
  });
});

/**
 * @vitest-environment node
 *
 * Real crypto throughout (WebCrypto AES-GCM + libsodium X25519), same
 * discipline `master-key.test.ts` already established.
 */
import { describe, expect, it } from 'vitest';
import {
  generateSchoolKey,
  setupSchoolKeyMaterial,
  unwrapAdminX25519PrivateKey,
  unwrapSchoolKey,
} from './school-key';
import { openSealedBox, sealToPublicKey } from './x25519';
import { hexToBytes } from './encoding';

function randomMasterKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

describe('generateSchoolKey', () => {
  it('generates a fresh 32-byte key on every call', () => {
    const a = generateSchoolKey();
    const b = generateSchoolKey();
    expect(a.length).toBe(32);
    expect(a).not.toEqual(b);
  });
});

describe('setupSchoolKeyMaterial', () => {
  it('returns three independent hex fields matching the schools table column names', async () => {
    const masterKey = randomMasterKey();
    const result = await setupSchoolKeyMaterial(masterKey);

    expect(result.schoolWrappedKeyByAdminMasterKey).toMatch(/^[0-9a-f]+$/i);
    expect(result.adminX25519PublicKey).toMatch(/^[0-9a-f]+$/i);
    expect(result.adminX25519WrappedPrivateKey).toMatch(/^[0-9a-f]+$/i);
    expect(result.schoolWrappedKeyByAdminMasterKey).not.toBe(result.adminX25519WrappedPrivateKey);
  });

  it('generates fresh material on every call, even under the same master key', async () => {
    const masterKey = randomMasterKey();
    const a = await setupSchoolKeyMaterial(masterKey);
    const b = await setupSchoolKeyMaterial(masterKey);
    expect(a.schoolWrappedKeyByAdminMasterKey).not.toBe(b.schoolWrappedKeyByAdminMasterKey);
    expect(a.adminX25519PublicKey).not.toBe(b.adminX25519PublicKey);
  });
});

describe('unwrapSchoolKey', () => {
  it('recovers the exact school key that was wrapped', async () => {
    const masterKey = randomMasterKey();
    const material = await setupSchoolKeyMaterial(masterKey);

    const unwrapped = await unwrapSchoolKey(masterKey, material.schoolWrappedKeyByAdminMasterKey);

    expect(unwrapped.length).toBe(32);
  });

  it('fails to unwrap with the wrong master key', async () => {
    const material = await setupSchoolKeyMaterial(randomMasterKey());
    await expect(
      unwrapSchoolKey(randomMasterKey(), material.schoolWrappedKeyByAdminMasterKey),
    ).rejects.toThrow();
  });
});

describe('unwrapAdminX25519PrivateKey', () => {
  it('recovers a private key that can open a box sealed to the matching public key', async () => {
    const masterKey = randomMasterKey();
    const material = await setupSchoolKeyMaterial(masterKey);

    const privateKey = await unwrapAdminX25519PrivateKey(
      masterKey,
      material.adminX25519WrappedPrivateKey,
    );
    const publicKey = hexToBytes(material.adminX25519PublicKey);

    // End-to-end proof this is the real M3-015/016 flow: a "teacher"
    // seals a message to the public key `setupSchoolKeyMaterial` returned,
    // and the private key unwrapped here (as the admin would, in a later
    // session) actually opens it.
    const message = new Uint8Array([42, 7, 1]);
    const sealedHex = await sealToPublicKey(publicKey, message);
    const opened = await openSealedBox({ publicKey, privateKey }, sealedHex);

    expect(opened).toEqual(message);
  });

  it('fails to unwrap with the wrong master key', async () => {
    const material = await setupSchoolKeyMaterial(randomMasterKey());
    await expect(
      unwrapAdminX25519PrivateKey(randomMasterKey(), material.adminX25519WrappedPrivateKey),
    ).rejects.toThrow();
  });
});

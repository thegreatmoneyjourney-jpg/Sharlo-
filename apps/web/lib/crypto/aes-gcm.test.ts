/**
 * @vitest-environment node
 *
 * jsdom (this project's default test environment) does not implement
 * `crypto.subtle` at all (confirmed directly — `typeof window.crypto.subtle`
 * is `undefined` under jsdom v30, even though `crypto.getRandomValues` is
 * present) — only Node's own global WebCrypto does. This module never
 * touches the DOM, so running its tests under the `node` environment
 * instead is correct, not a workaround.
 */
import { describe, expect, it } from 'vitest';
import { aesGcmDecrypt, aesGcmEncrypt } from './aes-gcm';

describe('aesGcmEncrypt / aesGcmDecrypt', () => {
  it('round-trips plaintext through encrypt then decrypt', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode('a 256-bit master key would go here');

    const blob = await aesGcmEncrypt(key, plaintext);
    const decrypted = await aesGcmDecrypt(key, blob);

    expect(new TextDecoder().decode(decrypted)).toBe('a 256-bit master key would go here');
  });

  it('produces a different IV (and different ciphertext) on every call, even for identical inputs', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode('same plaintext both times');

    const blobA = await aesGcmEncrypt(key, plaintext);
    const blobB = await aesGcmEncrypt(key, plaintext);

    expect(blobA).not.toEqual(blobB);
  });

  it('fails cleanly (throws) on the wrong key — never returns partial or corrupted plaintext', async () => {
    const rightKey = crypto.getRandomValues(new Uint8Array(32));
    const wrongKey = crypto.getRandomValues(new Uint8Array(32));
    const blob = await aesGcmEncrypt(rightKey, new TextEncoder().encode('secret'));

    await expect(aesGcmDecrypt(wrongKey, blob)).rejects.toThrow();
  });

  it('fails cleanly (throws) if the ciphertext has been tampered with', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const blob = await aesGcmEncrypt(key, new TextEncoder().encode('secret'));
    const tampered = new Uint8Array(blob);
    tampered[tampered.length - 1] ^= 0xff; // flip the last byte of the authenticated ciphertext

    await expect(aesGcmDecrypt(key, tampered)).rejects.toThrow();
  });

  it('rejects a blob too short to contain an IV', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    await expect(aesGcmDecrypt(key, new Uint8Array(4))).rejects.toThrow(/too short/);
  });
});

/**
 * @vitest-environment node
 *
 * Real libsodium (unmocked), same discipline `argon2id.test.ts` already
 * established for this project's other libsodium-backed primitive.
 */
import { describe, expect, it } from 'vitest';
import { generateX25519KeyPair, openSealedBox, sealToPublicKey } from './x25519';

describe('generateX25519KeyPair', () => {
  it('returns a public and private key, different on every call', async () => {
    const a = await generateX25519KeyPair();
    const b = await generateX25519KeyPair();

    expect(a.publicKey.length).toBeGreaterThan(0);
    expect(a.privateKey.length).toBeGreaterThan(0);
    expect(a.publicKey).not.toEqual(b.publicKey);
    expect(a.privateKey).not.toEqual(b.privateKey);
  });
});

describe('sealToPublicKey / openSealedBox', () => {
  it('round-trips a message through seal then open with the matching keypair', async () => {
    const keyPair = await generateX25519KeyPair();
    const message = new TextEncoder().encode('a 32-byte school key would go here');

    const sealedHex = await sealToPublicKey(keyPair.publicKey, new Uint8Array(message));
    const opened = await openSealedBox(keyPair, sealedHex);

    expect(opened).toEqual(new Uint8Array(message));
  });

  it('produces hex ciphertext that never contains the plaintext message', async () => {
    const keyPair = await generateX25519KeyPair();
    const distinctivePlaintext = new TextEncoder().encode('a very distinctive plaintext value');

    const sealedHex = await sealToPublicKey(
      keyPair.publicKey,
      new Uint8Array(distinctivePlaintext),
    );

    expect(sealedHex).toMatch(/^[0-9a-f]+$/i);
    expect(sealedHex).not.toContain(Buffer.from(distinctivePlaintext).toString('hex'));
  });

  it('fails to open with the wrong keypair, never returning partial/garbage output', async () => {
    const recipientKeyPair = await generateX25519KeyPair();
    const wrongKeyPair = await generateX25519KeyPair();
    const message = new Uint8Array([1, 2, 3, 4, 5]);

    const sealedHex = await sealToPublicKey(recipientKeyPair.publicKey, message);

    await expect(openSealedBox(wrongKeyPair, sealedHex)).rejects.toThrow();
  });

  it('does not require the sender to have a keypair of their own', async () => {
    // sealToPublicKey only ever takes a public key + the message — no
    // sender keypair parameter exists to pass one, which is the point:
    // this type signature itself is the proof the primitive doesn't need
    // sender authentication, matching this module's own doc comment.
    const recipientKeyPair = await generateX25519KeyPair();
    const sealedHex = await sealToPublicKey(recipientKeyPair.publicKey, new Uint8Array([9, 9]));
    const opened = await openSealedBox(recipientKeyPair, sealedHex);
    expect(opened).toEqual(new Uint8Array([9, 9]));
  });
});

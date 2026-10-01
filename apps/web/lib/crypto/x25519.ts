import { bytesToHex, hexToBytes, type Bytes } from './encoding';

/**
 * `M3-014`/Addendum 9's resolution of the ADR-0010 gap flagged while
 * starting the School-plan subsystem: `school_members.school_pubkey_copy`
 * implies sharing a symmetric secret (the school key) from a teacher's
 * browser to a school admin's browser through a server that must never
 * read it — which needs *some* public-key mechanism, and this codebase's
 * only crypto built so far (`ADR-0005`) is entirely symmetric
 * (Argon2id + AES-256-GCM). Founder-directed resolution: libsodium's
 * X25519 "sealed box" (`crypto_box_seal`/`crypto_box_seal_open`) — no new
 * dependency (`libsodium-wrappers-sumo` is already installed for
 * `argon2id.ts`'s Argon2id), and the right primitive shape for this exact
 * scenario: a sender encrypts to a recipient's public key with no live
 * interaction, no shared secret, and (deliberately) no sender
 * authentication — the relevant trust boundary here is "only the
 * recipient's private key can open this," not "prove who sent it" (a
 * separate concern this app's own audit trail/metadata already covers,
 * not this primitive's job).
 *
 * Deliberately generic — this module has no idea what it's protecting
 * (a school key, or anything else later). `school-key.ts` is the
 * School-plan-specific orchestration that calls this; keep it that way
 * rather than folding "school" concepts in here.
 */

type Sodium = typeof import('libsodium-wrappers-sumo').default;

let sodiumPromise: Promise<Sodium> | null = null;

async function loadSodium(): Promise<Sodium> {
  if (!sodiumPromise) {
    sodiumPromise = import('libsodium-wrappers-sumo').then(async ({ default: sodium }) => {
      await sodium.ready;
      return sodium;
    });
  }
  return sodiumPromise;
}

export interface X25519KeyPair {
  publicKey: Bytes;
  privateKey: Bytes;
}

/** A fresh X25519 keypair. Callers are responsible for wrapping/storing `privateKey` — this module never persists anything itself. */
export async function generateX25519KeyPair(): Promise<X25519KeyPair> {
  const sodium = await loadSodium();
  const { publicKey, privateKey } = sodium.crypto_box_keypair();
  // Same libsodium .d.ts-predates-TS-5.7 widening `argon2id.ts` already
  // works around — copy into a fresh `Bytes`-typed buffer rather than cast.
  return {
    publicKey: new Uint8Array(publicKey),
    privateKey: new Uint8Array(privateKey),
  };
}

/**
 * Seals `message` to `recipientPublicKey` — anyone can call this with just
 * the recipient's *public* key (no keypair of the caller's own needed, no
 * network round-trip to the recipient); only `openSealedBox` with the
 * matching private key can recover `message`. Returns hex, matching every
 * other at-rest/in-transit byte value in `lib/crypto/`.
 */
export async function sealToPublicKey(recipientPublicKey: Bytes, message: Bytes): Promise<string> {
  const sodium = await loadSodium();
  const sealed = sodium.crypto_box_seal(message, recipientPublicKey);
  return bytesToHex(new Uint8Array(sealed));
}

/**
 * Opens a sealed box produced by `sealToPublicKey`. Needs the full
 * recipient keypair (sealed-box opening is defined in terms of both) —
 * never just the private key. Throws — never returns partial/garbage
 * output — if the keypair doesn't match or `sealedHex` was tampered with;
 * `crypto_box_seal_open` itself is the authenticated primitive this
 * guarantee comes from, the same "no additional check needed on top"
 * shape `aes-gcm.ts`'s own doc comment already establishes for AES-GCM.
 */
export async function openSealedBox(keyPair: X25519KeyPair, sealedHex: string): Promise<Bytes> {
  const sodium = await loadSodium();
  const opened = sodium.crypto_box_seal_open(
    hexToBytes(sealedHex),
    keyPair.publicKey,
    keyPair.privateKey,
  );
  return new Uint8Array(opened);
}

/** Test-only: reset the module-level cache between test cases. */
export function _resetX25519LoaderForTests(): void {
  sodiumPromise = null;
}

/**
 * Argon2id KDF via `libsodium-wrappers-sumo` — the "sumo" build
 * specifically, since the base `libsodium-wrappers` package excludes
 * `crypto_pwhash`/Argon2id entirely. Compiled via Emscripten from the same
 * C source as the original libsodium library, maintained by libsodium's
 * own original author (jedisct1) — not a hand-rolled KDF implementation,
 * per the founder's explicit instruction to use an established, audited
 * library for every cryptographic primitive in this task, never custom
 * crypto logic.
 *
 * Loaded via a normal dynamic `import()`, deliberately NOT the
 * `<script>`-tag pattern `../scanning/opencv-loader.ts` uses — that
 * workaround exists because OpenCV.js's ~11MB legacy emscripten UMD build
 * hangs under bundler processing (measured: 2+ minutes, never finished).
 * `libsodium-wrappers-sumo` is a small (~540KB unpacked) package with a
 * proper ESM build (a real `module`/`exports.import` entry, not one giant
 * UMD file), so it bundles cleanly and a plain lazy `import()` is the
 * right amount of complexity — matching this app's own "defer loading
 * until a caller actually needs it" (NFR-PERF-02) without copying a
 * workaround this package doesn't need.
 */

import type { Bytes } from './encoding';

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

/** Versioned, not just raw numbers — matches this codebase's `schemaVersion` ethos so a future cost-parameter or KDF change can still unwrap old records correctly instead of assuming today's defaults. */
export interface Argon2idParams {
  algorithm: 'argon2id';
  opsLimit: number;
  memLimit: number;
}

const MASTER_KEY_WRAP_KEY_BYTES = 32; // 256-bit AES-GCM wrapping key

/**
 * MODERATE tier — deliberately NOT SENSITIVE, weighed against this
 * project's own documented reference device class (`docs/SRS.md`
 * NFR-PERF-01: a mid-range 2020-or-later smartphone, 4-core mobile SoC,
 * **4GB RAM**, mid-tier mobile browser). libsodium's SENSITIVE tier costs
 * roughly 1GiB of memory; on a real 4GB-class device that headroom is
 * already shared with the OS, background apps, the browser's own
 * baseline heap, and — specifically in this app — OpenCV.js's WASM heap
 * on scanning pages. Many real budget/mid-range Android phones in this
 * class have meaningfully *less* free headroom than the raw 4GB figure
 * suggests. An out-of-memory crash during signup, a passphrase change, or
 * (worst of all) a recovery attempt is a far worse failure than "very
 * strong but not maximal" KDF cost — it would block onboarding or
 * recovery entirely for exactly the underserved/budget-device users this
 * reference class exists to protect. MODERATE (~256MiB) leaves comfortable
 * headroom and is still a serious, modern, memory-hard cost parameter —
 * one of libsodium's own *named* tiers, not a hand-tuned custom number —
 * dramatically stronger against GPU/ASIC cracking than a non-memory-hard
 * KDF (PBKDF2/bcrypt) at any cost setting. See `docs/reports/SHARLO-M3-003.md`
 * for the full reasoning; revisit only if real-device testing (in the
 * spirit of `M1-011`) shows either figure is wrong in practice.
 */
export async function getDefaultArgon2idParams(): Promise<Argon2idParams> {
  const sodium = await loadSodium();
  return {
    algorithm: 'argon2id',
    opsLimit: sodium.crypto_pwhash_argon2id_OPSLIMIT_MODERATE,
    memLimit: sodium.crypto_pwhash_argon2id_MEMLIMIT_MODERATE,
  };
}

/** Exactly `crypto_pwhash_argon2id_SALTBYTES` long — required for this specific algorithm's salt size. */
export async function generateKdfSalt(): Promise<Bytes> {
  const sodium = await loadSodium();
  // libsodium's own .d.ts predates TS 5.7's generic Uint8Array<TArrayBuffer>
  // change and returns the wider, un-parameterized type — copying into a
  // fresh Uint8Array is both the type fix and a real (if redundant in
  // practice) guarantee of a plain-ArrayBuffer-backed result, not a bare
  // cast papering over a potential mismatch.
  return new Uint8Array(sodium.randombytes_buf(sodium.crypto_pwhash_argon2id_SALTBYTES));
}

/**
 * Derives a 256-bit AES-GCM wrapping key from a passphrase. Deterministic
 * for a given (passphrase, salt, params) triple — same inputs always
 * produce the same key, which unwrapping on a later visit depends on.
 */
export async function deriveWrappingKeyFromPassphrase(
  passphrase: string,
  salt: Bytes,
  params: Argon2idParams,
): Promise<Bytes> {
  if (params.algorithm !== 'argon2id') {
    throw new Error(`Unsupported KDF algorithm: ${params.algorithm}`);
  }
  const sodium = await loadSodium();
  // Same libsodium .d.ts widening as generateKdfSalt above.
  return new Uint8Array(
    sodium.crypto_pwhash(
      MASTER_KEY_WRAP_KEY_BYTES,
      passphrase,
      salt,
      params.opsLimit,
      params.memLimit,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    ),
  );
}

/** Test-only: reset the module-level cache between test cases. */
export function resetArgon2idLoaderForTests(): void {
  sodiumPromise = null;
}

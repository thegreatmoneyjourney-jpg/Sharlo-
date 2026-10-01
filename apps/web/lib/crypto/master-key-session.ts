import type { Bytes } from './encoding';

/**
 * `M3-007` — the first shared "is the master key available right now for
 * this browser tab?" mechanism. Every encryption/decryption operation
 * through `M3-006` unwrapped the master key transiently inside a single
 * handler and let it go out of scope immediately after
 * (`settings-client.tsx`'s passphrase-change/Recovery-Key-rotation
 * flows) — fine for an action the teacher takes once, but a feature that
 * needs to encrypt/decrypt repeatedly across a whole session (roster
 * upload now; results persistence next, `M3-008`) can't re-prompt for
 * the passphrase before every single operation without making the
 * product unusable.
 *
 * In-memory only, module-level state — never written to
 * `localStorage`/IndexedDB/a cookie, the same "cache it, don't persist
 * it" tradeoff `lib/api/drive-token-client.ts` already made for the
 * (less sensitive) Drive access token: losing the cache costs one more
 * passphrase prompt, not a security exposure. Unlike the Drive token,
 * this can't silently "refresh" itself — there's no way to re-derive the
 * master key without the teacher's passphrase, so once cleared (tab
 * close, reload, or an explicit lock) the only way back in is asking
 * again via `app/(app)/use-master-key.ts`.
 */

let cachedMasterKey: Bytes | null = null;

export function getCachedMasterKey(): Bytes | null {
  return cachedMasterKey;
}

export function setCachedMasterKey(masterKey: Bytes): void {
  cachedMasterKey = masterKey;
}

/** Explicit "lock this session" action — clears the cached key without waiting for a reload. Deliberately doesn't zero the underlying buffer: a caller from the same unlock call may still hold its own reference, and this module never assumes it's the only holder. */
export function clearCachedMasterKey(): void {
  cachedMasterKey = null;
}

/** Test-only: resets the module-level cache so each test starts clean. */
export function _resetMasterKeySessionForTests(): void {
  cachedMasterKey = null;
}

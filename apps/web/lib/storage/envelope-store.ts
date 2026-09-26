import { fetchAccountInfo } from '../api/account-client';
import * as driveEnvelopeStore from './drive-envelope-store';
import * as localEnvelopeStore from './local-envelope-store';
import type { StoredEnvelope } from './local-envelope-store';

/**
 * `M3-006` — the facade every future feature (`M3-007` onward) should
 * import instead of reaching for `local-envelope-store.ts` or
 * `drive-envelope-store.ts` directly. Picks the right backend from the
 * account's own `authMode` so calling code never branches on account
 * type itself — the same "no provider-specific branching downstream"
 * goal `M3-005`'s auth work already established for session handling.
 */
export interface EnvelopeStore {
  putEnvelope(envelope: StoredEnvelope): Promise<void>;
  getEnvelope(recordId: string): Promise<StoredEnvelope | undefined>;
  deleteEnvelope(recordId: string): Promise<void>;
  listEnvelopesByType(type: string): Promise<StoredEnvelope[]>;
  listAllEnvelopes(): Promise<StoredEnvelope[]>;
}

let cachedAuthMode: 'google' | 'local_only' | null = null;

/**
 * `authMode` never changes mid-session (account-linking is explicitly
 * out of scope per `ADR-0018`'s "Future: account linking" — not built),
 * so this is cached for the page's lifetime rather than re-fetched on
 * every call.
 */
export async function getEnvelopeStore(): Promise<EnvelopeStore> {
  if (cachedAuthMode === null) {
    cachedAuthMode = (await fetchAccountInfo()).authMode;
  }
  return cachedAuthMode === 'local_only' ? localEnvelopeStore : driveEnvelopeStore;
}

/** Test-only: clears the cached `authMode` so each test starts clean. */
export function _resetEnvelopeStoreCacheForTests(): void {
  cachedAuthMode = null;
}

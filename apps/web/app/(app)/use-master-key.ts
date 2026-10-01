'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchEncryptionParams } from '@/lib/api/account-encryption-client';
import { unwrapMasterKeyByPassphrase } from '@/lib/crypto/master-key';
import type { StoredEncryptionParams } from '@/lib/crypto/master-key';
import type { Bytes } from '@/lib/crypto/encoding';
import {
  clearCachedMasterKey,
  getCachedMasterKey,
  setCachedMasterKey,
} from '@/lib/crypto/master-key-session';

export type MasterKeyState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'needs-setup' }
  | { status: 'error'; message: string }
  | { status: 'locked' }
  | { status: 'unlocked'; masterKey: Bytes };

export interface UseMasterKeyResult {
  state: MasterKeyState;
  /** Only meaningful while `state.status === 'locked'` — a wrong passphrase resolves `'wrong-passphrase'` rather than throwing, so a caller's form can show an inline error without a try/catch of its own. */
  unlock: (passphrase: string) => Promise<'ok' | 'wrong-passphrase'>;
  /** Clears this tab's cached key and returns to `'locked'` without a reload — e.g. a teacher stepping away from a shared computer. */
  lock: () => void;
}

type StoredParams = Pick<
  StoredEncryptionParams,
  'wrappedMasterKeyByPassphrase' | 'kdfSalt' | 'kdfParams'
>;

/**
 * `M3-007` — the reusable "does this feature have the master key it
 * needs right now?" hook. Checks `master-key-session.ts`'s cache first
 * (an already-unlocked session skips the passphrase prompt entirely,
 * including across client-side navigations within the same tab); only
 * hits `GET /account/encryption-params` when nothing is cached yet, the
 * exact same endpoint `settings-client.tsx` already uses to tell
 * `'needs-setup'` (no encryption chosen yet — nothing to unlock) apart
 * from `'locked'` (set up, but this tab hasn't unwrapped it yet).
 */
export function useMasterKey(): UseMasterKeyResult {
  // Resolved synchronously during the initial render, not via an effect
  // that calls setState right away — an already-cached key needs no
  // network round-trip at all, so there's no reason to render 'loading'
  // for even one frame first.
  const [state, setState] = useState<MasterKeyState>(() => {
    const cached = getCachedMasterKey();
    return cached ? { status: 'unlocked', masterKey: cached } : { status: 'loading' };
  });
  const storedParamsRef = useRef<StoredParams | null>(null);

  useEffect(() => {
    if (getCachedMasterKey()) return; // already resolved above; nothing to fetch

    let cancelled = false;
    fetchEncryptionParams()
      .then((params) => {
        if (cancelled) return;
        if (!params.hasEncryptionSetup) {
          setState({ status: 'needs-setup' });
          return;
        }
        storedParamsRef.current = {
          wrappedMasterKeyByPassphrase: params.wrappedMasterKeyByPassphrase!,
          kdfSalt: params.kdfSalt!,
          kdfParams: params.kdfParams!,
        };
        setState({ status: 'locked' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof Error && error.message.includes('401')) {
          setState({ status: 'signed-out' });
        } else {
          setState({ status: 'error', message: 'Could not load your encryption settings.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = useCallback(async (passphrase: string): Promise<'ok' | 'wrong-passphrase'> => {
    const stored = storedParamsRef.current;
    if (!stored) return 'wrong-passphrase';
    try {
      const masterKey = await unwrapMasterKeyByPassphrase(passphrase, stored);
      setCachedMasterKey(masterKey);
      setState({ status: 'unlocked', masterKey });
      return 'ok';
    } catch {
      return 'wrong-passphrase';
    }
  }, []);

  const lock = useCallback(() => {
    clearCachedMasterKey();
    setState({ status: 'locked' });
  }, []);

  return { state, unlock, lock };
}

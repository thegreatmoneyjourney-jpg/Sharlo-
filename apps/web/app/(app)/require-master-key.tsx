'use client';

import type { ReactNode } from 'react';
import type { Bytes } from '@/lib/crypto/encoding';
import { useMasterKey } from './use-master-key';
import { UnlockMasterKeyPrompt } from './unlock-master-key-prompt';

/**
 * `M3-007` — gates `children` behind having the master key available this
 * session, so a feature (roster upload now; exam-results persistence
 * next, `M3-008`) doesn't have to duplicate `useMasterKey`'s
 * loading/signed-out/needs-setup/locked plumbing at every call site.
 * Render-prop, not a plain `children: ReactNode` — the whole point is
 * that nothing inside can render before a real master key exists.
 *
 * Links the signed-out case to `/signin` (both Google and local-only
 * email/OTP) rather than `settings-client.tsx`'s older
 * `/auth/google/start`-only link — `/signin` didn't exist yet when that
 * code was written; a local-only account's session expiring should still
 * land them somewhere that can actually sign them back in.
 */
export function RequireMasterKey({
  children,
  unlockDescription,
}: {
  children: (masterKey: Bytes) => ReactNode;
  unlockDescription?: string;
}) {
  const { state, unlock } = useMasterKey();

  switch (state.status) {
    case 'loading':
      return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
    case 'signed-out':
      return (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          You need to{' '}
          <a href="/signin" className="text-emerald-600 underline">
            sign in
          </a>{' '}
          first.
        </p>
      );
    case 'needs-setup':
      return (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Set up your Encryption Passphrase in{' '}
          <a href="/settings" className="text-emerald-600 underline">
            Settings
          </a>{' '}
          first.
        </p>
      );
    case 'error':
      return <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>;
    case 'locked':
      return <UnlockMasterKeyPrompt onUnlock={unlock} description={unlockDescription} />;
    case 'unlocked':
      return <>{children(state.masterKey)}</>;
  }
}

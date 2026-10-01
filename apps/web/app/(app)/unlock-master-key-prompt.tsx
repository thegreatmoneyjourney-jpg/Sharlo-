'use client';

import { useState } from 'react';

const PRIMARY_BUTTON_CLASSES =
  'rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40';
const INPUT_CLASSES =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

/**
 * The `locked` half of `RequireMasterKey` — split out so the passphrase
 * form itself is unit-testable independent of `use-master-key.ts`'s
 * network/caching plumbing, and reusable anywhere a feature already has
 * its own `unlock` function in hand (matching this codebase's existing
 * split between pure/state logic and its presentational component, e.g.
 * `lib/scanning/review-queue.ts` vs `review-queue-panel.tsx`).
 */
export function UnlockMasterKeyPrompt({
  onUnlock,
  description,
}: {
  onUnlock: (passphrase: string) => Promise<'ok' | 'wrong-passphrase'>;
  description?: string;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      const outcome = await onUnlock(passphrase);
      if (outcome === 'wrong-passphrase') {
        setError('Incorrect passphrase. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4 dark:border-zinc-700">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        {description ?? 'Enter your Encryption Passphrase to continue.'}
      </p>
      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Encryption Passphrase
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && passphrase.length > 0 && !busy) void handleSubmit();
          }}
          className={INPUT_CLASSES}
        />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        disabled={passphrase.length === 0 || busy}
        onClick={handleSubmit}
        className={PRIMARY_BUTTON_CLASSES}
      >
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
    </div>
  );
}

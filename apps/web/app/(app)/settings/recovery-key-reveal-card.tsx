'use client';

import type { ReactNode } from 'react';

const PRIMARY_BUTTON_CLASSES =
  'rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40';

function downloadRecoveryKey(recoveryKeyDisplay: string) {
  const blob = new Blob(
    [
      'Sharlo Recovery Key\n\n',
      `${recoveryKeyDisplay}\n\n`,
      'Keep this somewhere safe (e.g. a password manager, or printed and stored securely).\n',
      'If you lose both your Encryption Passphrase and this Recovery Key, your data cannot be recovered by Sharlo or anyone else — we never have access to either.\n',
    ],
    { type: 'text/plain' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sharlo-recovery-key.txt';
  a.click();
  URL.revokeObjectURL(url);
}

export interface RecoveryKeyRevealCardProps {
  heading: string;
  description: ReactNode;
  recoveryKeyDisplay: string;
  confirmedSaved: boolean;
  onConfirmedSavedChange: (checked: boolean) => void;
  busy: boolean;
  busyLabel: string;
  continueLabel: string;
  error: string | null;
  onContinue: () => void;
}

/**
 * FR-AUTH-05/08 — the "shown once, forced confirmation before continuing"
 * Recovery Key display. One component, two call sites (`settings-client.tsx`'s
 * initial-setup flow and its Recovery-Key-reconfirm flow) — both need the
 * identical shape (show the key, offer a download, require an active
 * checkbox before the primary action unlocks), just triggered by a
 * different precondition and posting to a different endpoint, which is
 * the caller's job, not this presentational component's.
 */
export function RecoveryKeyRevealCard({
  heading,
  description,
  recoveryKeyDisplay,
  confirmedSaved,
  onConfirmedSavedChange,
  busy,
  busyLabel,
  continueLabel,
  error,
  onContinue,
}: RecoveryKeyRevealCardProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-amber-400 bg-amber-50 p-4 dark:border-amber-600 dark:bg-amber-950">
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">{heading}</h2>
        <p className="mt-2 text-sm text-amber-900 dark:text-amber-200">{description}</p>
      </div>

      <div className="rounded-md border border-zinc-300 bg-zinc-50 p-3 font-mono text-sm break-all dark:border-zinc-700 dark:bg-zinc-900">
        {recoveryKeyDisplay}
      </div>

      <button
        type="button"
        onClick={() => downloadRecoveryKey(recoveryKeyDisplay)}
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Download as text file
      </button>

      <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={confirmedSaved}
          onChange={(e) => onConfirmedSavedChange(e.target.checked)}
          className="mt-0.5"
        />
        I&apos;ve saved my Recovery Key somewhere safe
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        disabled={!confirmedSaved || busy}
        onClick={onContinue}
        className={PRIMARY_BUTTON_CLASSES}
      >
        {busy ? busyLabel : continueLabel}
      </button>
    </div>
  );
}

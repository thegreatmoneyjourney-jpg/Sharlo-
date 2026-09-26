'use client';

import { useEffect, useState } from 'react';
import { fetchRecoveryKeyReminderStatus } from '@/lib/api/account-encryption-client';

/**
 * FR-AUTH-09 — the "in-app persistent banner" half of the reminder
 * cadence. Lives in `(app)/layout.tsx` so it shows across every
 * authenticated page, not just `/settings`. The "X" only hides it for
 * this page view (component state, never persisted) — a passive dismiss
 * doesn't count as the real re-confirmation (`ADR-0005`'s addendum: "a
 * passive dismiss does not count and the reminder returns at the next
 * interval"), so it's back on the next page load/navigation until the
 * teacher actually completes the reconfirm flow at `/settings#recovery-key`.
 *
 * Silently renders nothing on a fetch failure (e.g. signed out, or the
 * API being briefly unreachable) — this is a soft nudge, not a gate, and
 * every page it wraps already handles its own auth state independently.
 */
export default function RecoveryKeyReminderBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [hiddenForThisView, setHiddenForThisView] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRecoveryKeyReminderStatus()
      .then((status) => {
        if (!cancelled) setShowBanner(status.showBanner);
      })
      .catch(() => {
        // Soft nudge, not a gate — see module doc comment.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!showBanner || hiddenForThisView) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <span>
        Please confirm your Sharlo Recovery Key is still saved —{' '}
        <a href="/settings#recovery-key" className="underline">
          review it now
        </a>
        .
      </span>
      <button
        type="button"
        onClick={() => setHiddenForThisView(true)}
        aria-label="Dismiss for now"
        className="shrink-0 text-amber-900/70 hover:text-amber-900 dark:text-amber-200/70 dark:hover:text-amber-200"
      >
        ✕
      </button>
    </div>
  );
}

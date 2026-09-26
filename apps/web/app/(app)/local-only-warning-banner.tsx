'use client';

import { useEffect, useState } from 'react';
import { fetchAccountInfo } from '@/lib/api/account-client';

/**
 * `FR-AUTH-06` — "teacher is shown a persistent, unmissable warning about
 * device-loss / browser-data-clearing risk." Deliberately has **no**
 * dismiss control, unlike `RecoveryKeyReminderBanner` — that banner's
 * per-view "X" is correct for a nudge the teacher can act on later;
 * "unmissable" for a standing data-loss risk that never stops being true
 * for as long as the account is local-only means it never goes away, not
 * even for one page view.
 *
 * Silently renders nothing on a fetch failure (e.g. signed out) — every
 * page this wraps already handles its own auth state independently, same
 * reasoning as the Recovery Key banner.
 */
export default function LocalOnlyWarningBanner() {
  const [isLocalOnly, setIsLocalOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAccountInfo()
      .then((info) => {
        if (!cancelled) setIsLocalOnly(info.authMode === 'local_only');
      })
      .catch(() => {
        // Soft — see module doc comment.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isLocalOnly) {
    return null;
  }

  return (
    <div className="bg-red-100 px-4 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
      <strong>Local-only account:</strong> your data is stored only in this browser. Clearing
      browser data or losing this device loses it permanently.{' '}
      <a href="/settings#backup" className="underline">
        Export a backup file
      </a>{' '}
      regularly to protect against this.
    </div>
  );
}

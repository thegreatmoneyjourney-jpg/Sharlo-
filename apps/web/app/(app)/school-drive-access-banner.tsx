'use client';

import { useEffect, useState } from 'react';
import {
  fetchMyMembership,
  submitConfirmDriveAccess,
  type MyMembership,
} from '@/lib/api/schools-client';
import { pickSchoolContainer } from '@/lib/drive/pick-school-container';

/**
 * `M3-015`/`FR-SCHOOL-02` — the teacher-facing half of `ADR-0010`'s
 * "Access-grant flow": a teacher who's been added to a school but hasn't
 * completed the one-time Google Picker step yet sees a clear, specific
 * prompt, not a silent failure the first time a dual-encrypted write is
 * attempted (`M3-016`, not built yet). Lives in `(app)/layout.tsx`
 * alongside the Recovery Key and local-only banners so it shows on every
 * authenticated page, the same reasoning those two already established.
 *
 * Silently renders nothing on a fetch failure or when there's no pending
 * membership — same "soft nudge, not a gate" shape
 * `recovery-key-reminder-banner.tsx` already uses, and every page this
 * wraps already handles its own auth state independently.
 *
 * Dismissible for this page view only (unlike the non-dismissible
 * local-only banner) — this is a one-time, clearly-actionable task with
 * a real completion state (`driveAccessGranted`), not a standing risk
 * that needs repeated nagging, so deferring it costs nothing; the same
 * reasoning the Recovery Key banner's own dismiss button already
 * establishes for a different, lower-stakes reason.
 */
export default function SchoolDriveAccessBanner() {
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [hiddenForThisView, setHiddenForThisView] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyMembership()
      .then((result) => {
        if (!cancelled) setMembership(result);
      })
      .catch(() => {
        // Soft nudge, not a gate — see module doc comment.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSelect() {
    if (!membership) return;
    setPickError(null);
    setPicking(true);
    try {
      const result = await pickSchoolContainer(membership.driveLocationId);
      switch (result.outcome) {
        case 'confirmed':
          await submitConfirmDriveAccess();
          setMembership({ ...membership, driveAccessGranted: true });
          break;
        case 'wrong_item':
          setPickError(
            `You selected "${result.pickedName}", but that's not the folder your admin shared with you. Please try again and select that one.`,
          );
          break;
        case 'cancelled':
          break;
      }
    } catch {
      setPickError("Couldn't open the Google Drive picker. Please try again.");
    } finally {
      setPicking(false);
    }
  }

  if (!membership || membership.driveAccessGranted || hiddenForThisView) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <div className="flex items-center justify-between gap-3">
        <span>
          Your school admin shared a Google Drive{' '}
          {membership.driveLocationType === 'shared_drive' ? 'Shared Drive' : 'folder'} with you —
          select it below to finish setting up.
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
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSelect}
          disabled={picking}
          className="rounded-md border border-amber-900/30 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200/50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-200/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
        >
          {picking ? 'Opening Google Drive…' : 'Select the shared folder'}
        </button>
        {pickError && <span className="text-xs text-red-700 dark:text-red-300">{pickError}</span>}
      </div>
    </div>
  );
}

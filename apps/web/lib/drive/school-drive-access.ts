import type { MyMembership } from '../api/schools-client';

export type SchoolDriveAccessCheck =
  | { ok: true }
  | { ok: false; reason: 'not_a_school_member' }
  | { ok: false; reason: 'drive_access_not_granted' };

/**
 * `M3-015`/`FR-SCHOOL-02` — the check `M3-016`'s dual-encrypted
 * exam-finalize write will need before attempting to write a school-key
 * copy into the school's Drive container: "A teacher who skips [the
 * Picker step] sees a clear, specific error/prompt on next finalize, not
 * a silent failure." Pure and synchronous (`membership` is whatever the
 * caller already fetched via `fetchMyMembership`) so `M3-016` can call it
 * inline, right before the write, without a fresh network round-trip of
 * its own.
 *
 * **Not wired into any real finalize call site yet** — `M3-016`
 * (dual-encryption on exam finalize) doesn't exist yet to call this from;
 * only the primitive is built here, tested in isolation, following the
 * same "build the complete primitive even if unused yet" precedent
 * `M3-003`'s own `rewrapMasterKeyByNewRecoveryKey` already established,
 * rather than leaving this as an unwritten TODO for whoever builds
 * `M3-016`. The "clear, specific prompt" half of `FR-SCHOOL-02`'s
 * acceptance criterion is already met by `school-drive-access-banner.tsx`
 * (shown on every authenticated page, including wherever `M3-016`'s own
 * finalize UI eventually lives) — `M3-016` still owns deciding whether
 * its own finalize call site additionally surfaces an inline
 * error/disables its own "finalize" control on a failing check, which
 * needs context (what that UI actually looks like) this task doesn't
 * have, so it isn't guessed at here.
 */
export function ensureSchoolDriveAccess(membership: MyMembership | null): SchoolDriveAccessCheck {
  if (!membership) {
    return { ok: false, reason: 'not_a_school_member' };
  }
  if (!membership.driveAccessGranted) {
    return { ok: false, reason: 'drive_access_not_granted' };
  }
  return { ok: true };
}

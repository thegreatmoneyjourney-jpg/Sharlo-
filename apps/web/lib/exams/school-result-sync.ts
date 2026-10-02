import { fetchMyMembership } from '../api/schools-client';
import { ensureSchoolDriveAccess } from '../drive/school-drive-access';
import { putSealedRecord } from '../storage/school-container-store';
import { sealExamResultsForSchool, type ExamResults } from './exam-results';

/**
 * `M3-016`/`ADR-0010` — the orchestration `new-exam-client.tsx`'s finalize
 * flow calls right after the teacher's own individual save
 * (`saveExamResults`) already succeeded. Deliberately **never throws** —
 * every failure mode (not a school member, Picker step not done yet, a
 * genuine network/Drive error) resolves to a result object instead,
 * because a school-copy problem must never block or delay the teacher's
 * own save, which is the critical path and has already completed by the
 * time this runs. `FR-SCHOOL-02`'s "clear, specific prompt, not a silent
 * failure" for the *not-eligible* cases (`not_a_school_member` /
 * `drive_access_not_granted`) is already handled by the standing
 * `school-drive-access-banner.tsx` (`M3-015`), shown on every authenticated
 * page including wherever this redirects to — so this function doesn't
 * need to (and deliberately doesn't try to) duplicate that messaging.
 *
 * `attempted: false` (not eligible right now, nothing went wrong) is kept
 * distinct from `attempted: true, ok: false` (eligible, but the seal+write
 * itself failed) — the caller doesn't currently branch on this distinction
 * for UI purposes, but it's real information worth preserving rather than
 * collapsing into one boolean, and it's what each branch's own test
 * asserts on.
 */
export type SchoolResultSyncOutcome =
  | { attempted: false }
  | { attempted: true; ok: true }
  | { attempted: true; ok: false; error: unknown };

export async function syncExamResultsToSchool(exam: ExamResults): Promise<SchoolResultSyncOutcome> {
  try {
    const membership = await fetchMyMembership();
    if (!membership) {
      return { attempted: false };
    }
    const check = ensureSchoolDriveAccess(membership);
    if (!check.ok) {
      return { attempted: false };
    }

    const sealed = await sealExamResultsForSchool(membership.adminX25519PublicKey, exam);
    await putSealedRecord(membership.driveLocationId, sealed);
    return { attempted: true, ok: true };
  } catch (error) {
    return { attempted: true, ok: false, error };
  }
}

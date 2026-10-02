import { fetchAccountInfo } from '../api/account-client';
import { submitRemoveTeacher, type DriveLocationType } from '../api/schools-client';
import {
  attemptOwnershipTransferForDepartingTeacher,
  type FileTransferResult,
} from './transfer-teacher-owned-files';
import { revokeSchoolContainerAccess } from './revoke-school-container-access';

export interface RemoveTeacherOutcome {
  /**
   * `null` on the Shared Drive path — the ownership-transfer step is
   * never attempted there (`ADR-0010`'s own "Teacher removal" section:
   * it's preceded by that step only "for the fallback (folder) path").
   * An empty array on the folder path means the teacher owned no files.
   */
  transferResults: FileTransferResult[] | null;
  /** Whether the `school_members` row was actually deleted — `false` means it was already gone (another request got there first), not an error. */
  removed: boolean;
}

/**
 * `M3-018`/`ADR-0010` — the full teacher-removal sequence, in the order
 * the ADR's own "Teacher removal" section requires: attempt ownership
 * transfer (folder path only) *before* revoking the Drive permission —
 * revoking first would strip the admin's own inherited permission these
 * files need for the self-upgrade attempt (`transfer-teacher-owned-files.ts`'s
 * own doc comment). The database row is deleted *last*, and only once
 * `revokeSchoolContainerAccess` has actually succeeded — if revocation
 * throws (a real Drive/network failure, not "nothing to revoke," which
 * is already a no-op there), this function throws too and the
 * `school_members` row is deliberately left in place so the admin's
 * next retry still has the teacher's email/Drive-location context to
 * work from, rather than silently discarding a membership row whose
 * Drive access was never actually confirmed revoked.
 */
export async function removeTeacherFromSchool(
  school: { id: string; driveLocationType: DriveLocationType; driveLocationId: string },
  member: { id: string; email: string },
): Promise<RemoveTeacherOutcome> {
  const { email: adminEmail } = await fetchAccountInfo();

  const transferResults =
    school.driveLocationType === 'folder'
      ? await attemptOwnershipTransferForDepartingTeacher(
          school.driveLocationId,
          member.email,
          adminEmail,
        )
      : null;

  await revokeSchoolContainerAccess(school.driveLocationId, member.email);
  const removed = await submitRemoveTeacher(school.id, member.id);

  return { transferResults, removed };
}

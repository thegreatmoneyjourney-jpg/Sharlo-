import { driveFetch } from './drive-fetch';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

/**
 * `M3-018`/`ADR-0010`'s own "Teacher removal" section — the counterpart
 * to `shareSchoolContainer.ts` (`M3-015`). Drive's permission-delete API
 * needs the permission's own id, not the teacher's email, so this is a
 * find-then-delete, not a single call — `permissions.list`'s own `fields`
 * param lets us ask for just `(id, emailAddress)` rather than every
 * permission's full detail. `supportsAllDrives=true` is included
 * unconditionally on both calls (harmless for a plain folder, required
 * for a Shared Drive), same pattern `shareSchoolContainer.ts` already
 * established.
 */

interface DrivePermission {
  id: string;
  emailAddress?: string;
}

async function findPermissionId(
  containerId: string,
  teacherEmail: string,
): Promise<string | undefined> {
  const url =
    `${DRIVE_FILES_URL}/${containerId}/permissions?supportsAllDrives=true` +
    `&fields=${encodeURIComponent('permissions(id,emailAddress)')}`;
  const response = await driveFetch(url);
  const body = (await response.json()) as { permissions: DrivePermission[] };
  return body.permissions.find((p) => p.emailAddress === teacherEmail)?.id;
}

/**
 * Revokes a departing teacher's access to the school's Drive container.
 * A no-op (not an error) if the teacher has no permission on the
 * container at all — matches `drive-envelope-store.ts`'s own established
 * "deleting something already gone is a no-op" convention — which covers
 * both "never actually completed the Picker step" and "already removed."
 */
export async function revokeSchoolContainerAccess(
  containerId: string,
  teacherEmail: string,
): Promise<void> {
  const permissionId = await findPermissionId(containerId, teacherEmail);
  if (!permissionId) {
    return;
  }
  await driveFetch(
    `${DRIVE_FILES_URL}/${containerId}/permissions/${permissionId}?supportsAllDrives=true`,
    { method: 'DELETE' },
  );
}

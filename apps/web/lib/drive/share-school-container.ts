import { driveFetch } from './drive-fetch';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

/**
 * `M3-015`/`ADR-0010`'s own "Access-grant flow" step 2 — the admin's
 * browser shares the school's Drive container with a newly added
 * teacher's Google account (Editor/`writer` access), browser-direct to
 * Google, zero backend involvement (`ADR-0004`). `supportsAllDrives=true`
 * is required whenever the target might be a Shared Drive
 * (`driveLocationType === 'shared_drive'`) and harmless for the plain
 * personal-folder path too, so it's always included rather than
 * branching on type.
 *
 * This alone does *not* give the teacher's `drive.file`-scoped session
 * write access to the container — a Drive permission and `drive.file`'s
 * own app-created-or-explicitly-picked grant are two separate things
 * (ADR-0010's own "Access-grant flow" section). The teacher's one-time
 * Picker selection (`M3-015`'s own teacher-facing UI) is what actually
 * completes that; this function is only step 2 of the flow, never a
 * substitute for step 3.
 */
export async function shareSchoolContainer(
  driveLocationId: string,
  teacherEmail: string,
): Promise<void> {
  await driveFetch(`${DRIVE_FILES_URL}/${driveLocationId}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: teacherEmail }),
  });
}

import { driveFetch } from './drive-fetch';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

/**
 * `M3-018`/`ADR-0010`'s folder-path (personal-account) teacher-removal
 * mitigation: "the admin's authenticated client attempts a Drive API
 * ownership transfer of any files still owned by the departing teacher
 * onto the admin's own account." Never called for the Shared Drive path
 * — "ownership transfers are not supported for files and folders in
 * shared drives" (Drive API docs), which matches ADR-0010's own framing
 * that Shared-Drive files are never teacher-owned in the first place;
 * the query below naturally returns nothing for that path regardless, so
 * no caller-side branching on `driveLocationType` is needed here.
 *
 * **Real, founder-facing uncertainty about this mechanism's actual
 * success rate, found via research (not verified against a live Drive
 * account — this project has none, the same category of gap `M3-006`/
 * `M1-011` already carry) — see `docs/reports/SHARLO-M3-018.md`'s Flags
 * for the full account:** Drive's documented ownership-transfer flow is
 * owner-initiated (the *current* owner calls this to hand ownership to
 * someone else) and, even then, typically requires the *recipient*'s
 * separate consent/acceptance — the API has been observed returning
 * `403 Consent is required to transfer ownership` even for same-domain
 * transfers attempted programmatically. This function's call shape (the
 * *admin*, a non-owner who already holds an inherited Editor-level
 * permission on the file via the shared folder, upgrading their own
 * permission entry to `role: owner`) is the only version of this call
 * our app's admin session could even attempt without the departing
 * teacher's live cooperation — but there is real reason to doubt Drive
 * honors a non-owner-initiated self-upgrade at all, which would make
 * this mechanism fail by construction in exactly the adversarial/
 * uncooperative-teacher scenario it exists to mitigate. Built faithfully
 * anyway (in case real-world behavior is more permissive than available
 * documentation suggests, and because ADR-0010 already frames this as
 * "best-effort," never "guaranteed") — every outcome is reported per
 * file, never silently assumed to have succeeded.
 */

export interface FileTransferResult {
  fileId: string;
  fileName: string;
  outcome: 'transferred' | 'transfer_failed';
  /** Only set when `outcome` is `'transfer_failed'`. */
  error?: string;
}

/** Drive's own escaping rule for a literal `'` inside a `q` string value — same defense-in-depth every other Drive-query-building module in this codebase already applies. */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

interface DriveFilePermission {
  id: string;
  emailAddress?: string;
}

interface DriveFileWithPermissions {
  id: string;
  name: string;
  permissions?: DriveFilePermission[];
}

async function listTeacherOwnedFiles(
  folderId: string,
  teacherEmail: string,
): Promise<DriveFileWithPermissions[]> {
  const query =
    `'${escapeDriveQueryValue(folderId)}' in parents and trashed=false and ` +
    `'${escapeDriveQueryValue(teacherEmail)}' in owners`;
  const url =
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&supportsAllDrives=true&includeItemsFromAllDrives=true` +
    `&fields=${encodeURIComponent('files(id,name,permissions(id,emailAddress))')}&pageSize=1000`;
  const response = await driveFetch(url);
  const body = (await response.json()) as { files: DriveFileWithPermissions[] };
  return body.files;
}

/**
 * Attempts to transfer ownership of every file the departing teacher
 * still owns inside the school's folder onto the admin's own account.
 * `adminEmail` identifies which of a file's several inherited
 * permissions (every teacher sharing the folder has one) belongs to the
 * admin — without it, there would be no way to tell "the admin's own
 * permission" apart from any other teacher's. Must be called *before*
 * `revokeSchoolContainerAccess`, per ADR-0010's own explicit ordering —
 * revoking first would strip the admin's own inherited permission on
 * these files too, making a self-upgrade impossible.
 *
 * Never throws — a failure on one file (or all of them) resolves to
 * `'transfer_failed'` with a specific error message, exactly matching
 * this task's own done-when criterion ("logs/surfaces its outcome...
 * rather than failing silently").
 */
export async function attemptOwnershipTransferForDepartingTeacher(
  folderId: string,
  teacherEmail: string,
  adminEmail: string,
): Promise<FileTransferResult[]> {
  const files = await listTeacherOwnedFiles(folderId, teacherEmail);

  return Promise.all(
    files.map(async (file): Promise<FileTransferResult> => {
      const adminPermissionId = file.permissions?.find((p) => p.emailAddress === adminEmail)?.id;
      if (!adminPermissionId) {
        return {
          fileId: file.id,
          fileName: file.name,
          outcome: 'transfer_failed',
          error: 'The admin has no existing permission entry on this file to upgrade to owner.',
        };
      }
      try {
        await driveFetch(
          `${DRIVE_FILES_URL}/${file.id}/permissions/${adminPermissionId}` +
            `?transferOwnership=true&supportsAllDrives=true`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'owner' }),
          },
        );
        return { fileId: file.id, fileName: file.name, outcome: 'transferred' };
      } catch (err) {
        return {
          fileId: file.id,
          fileName: file.name,
          outcome: 'transfer_failed',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

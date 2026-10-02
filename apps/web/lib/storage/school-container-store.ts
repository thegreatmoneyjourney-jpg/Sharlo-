import {
  _configureDriveFetchForTests,
  _resetDriveFetchForTests,
  driveFetch,
} from '../drive/drive-fetch';

/**
 * `M3-016` — the folder-scoped counterpart to `drive-envelope-store.ts`
 * (`M3-006`): that module reads/writes at the Drive *root*, which isn't
 * reusable here — a school's shared container (`school_members.driveLocationId`,
 * `M3-014`/`015`) is a specific Shared Drive or folder every teacher-under-
 * school writes into, never the teacher's own Drive root. Every write/query
 * here is additionally scoped by `'<parentFolderId>' in parents`, and
 * `supportsAllDrives=true`/`includeItemsFromAllDrives=true` are included on
 * every call unconditionally — harmless (and ignored) for the plain-folder
 * path, required for the Shared-Drive path (`shareSchoolContainer.ts`
 * already established this exact "always include, never branch on
 * `driveLocationType`" pattern for the identical reason).
 *
 * Deliberately content-agnostic, same as `drive-envelope-store.ts` itself:
 * this module has no idea the bytes it's moving are a libsodium sealed box
 * rather than an AES-GCM envelope — `SealedRecord` is this module's own
 * wrapper shape (`sealedCiphertext`, not `ciphertext`), and `lib/exams/
 * exam-results.ts`'s `sealExamResultsForSchool`/`unsealExamResultsForSchool`
 * own the sealing/unsealing and the content shape inside it.
 *
 * Only `put`/`get`/`listByType` are built — no `delete`, unlike
 * `drive-envelope-store.ts`'s full five-function shape: nothing in this
 * codebase deletes a school-key copy yet (a teacher's own individual
 * envelope delete, if that's ever built, has no reason to also delete the
 * school's copy — that's the admin-owned continuity guarantee ADR-0010's
 * whole point), so there's no real call site to build it against yet.
 */

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

/** Test-only: injects a fake `fetch` and/or access-token provider — same shared seam every other Drive-backed module uses. */
export const _configureSchoolContainerStoreForTests = _configureDriveFetchForTests;

/** Test-only: restores the shared fetch helper to its real implementation. */
export const _resetSchoolContainerStoreForTests = _resetDriveFetchForTests;

/**
 * The Drive-file wrapper around a sealed box — `recordId`/`type`/
 * `schemaVersion` are cleartext (Drive `appProperties`, string-only by
 * Drive's own constraint) purely so this module's own queries can find a
 * record without decrypting anything; `sealedCiphertext` (hex) is the only
 * field a party without the admin's private key can't read.
 */
export interface SealedRecord {
  schemaVersion: number;
  type: string;
  recordId: string;
  sealedCiphertext: string;
}

/** Drive's own escaping rule for a literal `'` inside a `q` string value — same defense-in-depth `drive-envelope-store.ts`'s identical helper already establishes. */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function findFileIdByRecordId(
  parentFolderId: string,
  recordId: string,
): Promise<string | undefined> {
  const query =
    `'${escapeDriveQueryValue(parentFolderId)}' in parents and ` +
    `appProperties has { key='recordId' and value='${escapeDriveQueryValue(recordId)}' } and trashed=false`;
  const url =
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id)')}` +
    `&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const response = await driveFetch(url);
  const body = (await response.json()) as { files: { id: string }[] };
  return body.files[0]?.id;
}

function buildMultipartBody(
  metadata: unknown,
  record: SealedRecord,
): { body: string; boundary: string } {
  const boundary = `sharlo-school-${crypto.randomUUID()}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(record)}\r\n` +
    `--${boundary}--`;
  return { body, boundary };
}

/**
 * `parentFolderId` is only included for a brand-new file's metadata — on
 * update (PATCH), Drive API v3's `parents` is deliberately omitted: Google's
 * own docs say modifying parents on an existing file needs the
 * `addParents`/`removeParents` query parameters, not the request body, and
 * this path never needs to move a file to a different parent anyway (the
 * same `recordId` always belongs to the same school/container for its
 * entire life).
 */
function driveMetadataFor(record: SealedRecord, parentFolderId?: string) {
  return {
    name: `Sharlo — ${record.type} — ${record.recordId}.json`,
    ...(parentFolderId ? { parents: [parentFolderId] } : {}),
    appProperties: {
      type: record.type,
      recordId: record.recordId,
      schemaVersion: String(record.schemaVersion),
    },
  };
}

/** Creates a new file inside `parentFolderId`, or overwrites the existing one tagged with this `recordId` — the same upsert-by-`recordId` semantic every other envelope store already has. */
export async function putSealedRecord(parentFolderId: string, record: SealedRecord): Promise<void> {
  const existingFileId = await findFileIdByRecordId(parentFolderId, record.recordId);
  const metadata = existingFileId
    ? driveMetadataFor(record)
    : driveMetadataFor(record, parentFolderId);
  const { body, boundary } = buildMultipartBody(metadata, record);
  const url = existingFileId
    ? `${DRIVE_UPLOAD_URL}/${existingFileId}?uploadType=multipart&supportsAllDrives=true`
    : `${DRIVE_UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true`;

  await driveFetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

export async function getSealedRecord(
  parentFolderId: string,
  recordId: string,
): Promise<SealedRecord | undefined> {
  const fileId = await findFileIdByRecordId(parentFolderId, recordId);
  if (!fileId) {
    return undefined;
  }
  const response = await driveFetch(
    `${DRIVE_FILES_URL}/${fileId}?alt=media&supportsAllDrives=true`,
  );
  return (await response.json()) as SealedRecord;
}

async function listFileIdsByQuery(query: string): Promise<string[]> {
  const url =
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id)')}` +
    `&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const response = await driveFetch(url);
  const body = (await response.json()) as { files: { id: string }[] };
  return body.files.map((file) => file.id);
  // pageSize=1000 (Drive's max), not paginated — same accepted-for-now
  // limitation `drive-envelope-store.ts`'s identical helper already notes;
  // no school's result set approaches that yet.
}

/** Every sealed record of `type` inside `parentFolderId` — `M3-017`'s own future listing primitive (the principal dashboard), built now and fully tested per this project's established "build the complete, tested primitive even before its first real call site" precedent (`M3-003`'s `rewrapMasterKeyByNewRecoveryKey`, `M3-015`'s `ensureSchoolDriveAccess`). */
export async function listSealedRecordsByType(
  parentFolderId: string,
  type: string,
): Promise<SealedRecord[]> {
  const query =
    `'${escapeDriveQueryValue(parentFolderId)}' in parents and ` +
    `appProperties has { key='type' and value='${escapeDriveQueryValue(type)}' } and trashed=false`;
  const fileIds = await listFileIdsByQuery(query);
  return Promise.all(
    fileIds.map(async (fileId) => {
      const response = await driveFetch(
        `${DRIVE_FILES_URL}/${fileId}?alt=media&supportsAllDrives=true`,
      );
      return (await response.json()) as SealedRecord;
    }),
  );
}

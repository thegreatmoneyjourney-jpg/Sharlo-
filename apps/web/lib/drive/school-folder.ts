import { driveFetch } from './drive-fetch';

/**
 * `M3-014`/`ADR-0010` — the personal-Google-account fallback path: a
 * plain Drive folder this app creates (and therefore owns) directly.
 * Unlike a Shared Drive, ordinary file/folder creation is squarely
 * within `drive.file` scope — no Picker step needed here, unlike
 * `shared-drive-picker.ts`'s Workspace path.
 */

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/** Creates a new Drive folder named after the school, returning its file id (the value `schools.driveLocationId` stores for the `'folder'` location type). */
export async function createSchoolFolder(schoolName: string): Promise<string> {
  const response = await driveFetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Sharlo — ${schoolName}`,
      mimeType: FOLDER_MIME_TYPE,
    }),
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

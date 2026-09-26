import { getDriveAccessToken } from '../api/drive-token-client';
import type { StoredEnvelope } from './local-envelope-store';

/**
 * `M3-006`/`ADR-0004` — the Drive-mode counterpart to `local-envelope-store.ts`,
 * same five-function shape, so `envelope-store.ts`'s facade can pick
 * between them without callers ever branching on account type. Every
 * request here goes straight from this browser to Google's own API using
 * a token from `drive-token-client.ts` — this module never calls our own
 * backend for anything except (indirectly, via that module) minting that
 * token, matching `ADR-0004`'s "zero backend involvement in the request
 * path" for the actual file operations.
 *
 * Drive's `appProperties` (`type`, `recordId`, `schemaVersion` — all
 * strings, Drive's own constraint) exist purely so `files.list`'s `q`
 * filter can find a record without downloading every file's content
 * first; the envelope itself (the real source of truth for all four
 * fields, `ciphertext` included) lives in the file's own content,
 * fetched with `alt=media`. Listing is therefore two round-trips deep —
 * one `files.list` for matching file ids, then one content fetch per
 * match (`Promise.all`, not sequential) — a real, inherent cost Drive's
 * API shape imposes that IndexedDB's `getAll()` doesn't have. Worth
 * knowing before a later, list-heavy feature (`M3-008` results table,
 * `M3-009` analytics) reaches for this against a Drive-mode account with
 * many records; Drive's batch API (one HTTP round-trip for many
 * sub-requests) is the documented way to collapse this if it ever
 * becomes a real bottleneck — not built here, since nothing in this
 * codebase yet lists enough records for it to matter.
 */

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

let fetchImpl: typeof fetch = fetch;
let getAccessToken: () => Promise<string> = getDriveAccessToken;

/**
 * Test-only: injects a fake `fetch` and/or access-token provider so this
 * module never makes a real Drive/network call in tests. Only overrides
 * whatever field is actually passed — a test that only cares about
 * `fetchImpl` shouldn't silently reset a `getAccessToken` an earlier
 * `beforeEach` already configured. Use `_resetDriveEnvelopeStoreForTests`
 * to put both back to their real defaults.
 */
export function _configureDriveEnvelopeStoreForTests(deps: {
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string>;
}): void {
  if (deps.fetchImpl) {
    fetchImpl = deps.fetchImpl;
  }
  if (deps.getAccessToken) {
    getAccessToken = deps.getAccessToken;
  }
}

/** Test-only: restores both `fetchImpl` and `getAccessToken` to their real implementations. */
export function _resetDriveEnvelopeStoreForTests(): void {
  fetchImpl = fetch;
  getAccessToken = getDriveAccessToken;
}

/** Drive's own escaping rule for a literal `'` inside a `q` string value. Defense-in-depth: every current caller only ever passes a UUID or one of our own fixed `type` strings, neither of which can contain one, but a query-string value should never trust that without escaping regardless. */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = await getAccessToken();
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Drive API request failed: ${response.status} ${await response.text()}`);
  }
  return response;
}

/** The Drive `fileId` for the (at most one) non-trashed file tagged with this `recordId`, or `undefined` if none exists yet. */
async function findFileIdByRecordId(recordId: string): Promise<string | undefined> {
  const query = `appProperties has { key='recordId' and value='${escapeDriveQueryValue(recordId)}' } and trashed=false`;
  const url = `${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id)')}&pageSize=1`;
  const response = await driveFetch(url);
  const body = (await response.json()) as { files: { id: string }[] };
  return body.files[0]?.id;
}

function buildMultipartBody(
  metadata: unknown,
  envelope: StoredEnvelope,
): { body: string; boundary: string } {
  const boundary = `sharlo-envelope-${crypto.randomUUID()}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(envelope)}\r\n` +
    `--${boundary}--`;
  return { body, boundary };
}

function driveMetadataFor(envelope: StoredEnvelope) {
  return {
    name: `Sharlo — ${envelope.type} — ${envelope.recordId}.json`,
    appProperties: {
      type: envelope.type,
      recordId: envelope.recordId,
      schemaVersion: String(envelope.schemaVersion),
    },
  };
}

/** Creates a new file, or overwrites the existing one tagged with this `recordId` — the same upsert-by-`recordId` semantic `local-envelope-store.ts`'s `putEnvelope` has. */
export async function putEnvelope(envelope: StoredEnvelope): Promise<void> {
  const existingFileId = await findFileIdByRecordId(envelope.recordId);
  const { body, boundary } = buildMultipartBody(driveMetadataFor(envelope), envelope);
  const url = existingFileId
    ? `${DRIVE_UPLOAD_URL}/${existingFileId}?uploadType=multipart`
    : `${DRIVE_UPLOAD_URL}?uploadType=multipart`;

  await driveFetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

export async function getEnvelope(recordId: string): Promise<StoredEnvelope | undefined> {
  const fileId = await findFileIdByRecordId(recordId);
  if (!fileId) {
    return undefined;
  }
  const response = await driveFetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`);
  return (await response.json()) as StoredEnvelope;
}

export async function deleteEnvelope(recordId: string): Promise<void> {
  const fileId = await findFileIdByRecordId(recordId);
  if (!fileId) {
    return; // matches local-envelope-store.ts: deleting a nonexistent record is a no-op, not an error
  }
  await driveFetch(`${DRIVE_FILES_URL}/${fileId}`, { method: 'DELETE' });
}

async function listFileIdsByQuery(query: string): Promise<string[]> {
  const url = `${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id)')}&pageSize=1000`;
  const response = await driveFetch(url);
  const body = (await response.json()) as { files: { id: string }[] };
  return body.files.map((file) => file.id);
  // pageSize=1000 (Drive's max) rather than paginating with nextPageToken:
  // no realistic account approaches 1000 records of one envelope type yet;
  // revisit if that assumption ever stops holding.
}

async function fetchEnvelopeContents(fileIds: string[]): Promise<StoredEnvelope[]> {
  const envelopes = await Promise.all(
    fileIds.map(async (fileId) => {
      const response = await driveFetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`);
      return (await response.json()) as StoredEnvelope;
    }),
  );
  return envelopes;
}

export async function listEnvelopesByType(type: string): Promise<StoredEnvelope[]> {
  const query = `appProperties has { key='type' and value='${escapeDriveQueryValue(type)}' } and trashed=false`;
  return fetchEnvelopeContents(await listFileIdsByQuery(query));
}

export async function listAllEnvelopes(): Promise<StoredEnvelope[]> {
  return fetchEnvelopeContents(await listFileIdsByQuery('trashed=false'));
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _configureSchoolContainerStoreForTests,
  _resetSchoolContainerStoreForTests,
  getSealedRecord,
  listSealedRecordsByType,
  putSealedRecord,
  type SealedRecord,
} from './school-container-store';

const PARENT_FOLDER_ID = 'school-folder-abc';

function makeRecord(overrides: Partial<SealedRecord> = {}): SealedRecord {
  return {
    schemaVersion: 1,
    type: 'schoolExamResults',
    recordId: 'record-1',
    sealedCiphertext: 'opaque-sealed-blob',
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
}

function filesListResponse(ids: string[]) {
  return jsonResponse({ files: ids.map((id) => ({ id })) });
}

function decodeQuery(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get('q')!);
}

beforeEach(() => {
  _configureSchoolContainerStoreForTests({ getAccessToken: async () => 'test-access-token' });
});

afterEach(() => {
  _resetSchoolContainerStoreForTests();
});

describe('putSealedRecord', () => {
  it('creates a new file scoped to the parent folder when none exists yet for this recordId', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(filesListResponse([]))
      .mockResolvedValueOnce(jsonResponse({}));
    _configureSchoolContainerStoreForTests({
      fetchImpl: fetchMock,
      getAccessToken: async () => 'tok',
    });

    const record = makeRecord();
    await putSealedRecord(PARENT_FOLDER_ID, record);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [findUrl] = fetchMock.mock.calls[0];
    expect(decodeQuery(findUrl)).toContain(`'${PARENT_FOLDER_ID}' in parents`);
    expect(decodeQuery(findUrl)).toContain("value='record-1'");
    expect(findUrl).toContain('supportsAllDrives=true');
    expect(findUrl).toContain('includeItemsFromAllDrives=true');

    const [createUrl, createInit] = fetchMock.mock.calls[1];
    expect(createUrl).toBe(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    );
    expect(createInit.method).toBe('POST');
    expect(createInit.headers.Authorization).toBe('Bearer tok');
    const contentType = createInit.headers['Content-Type'] as string;
    expect(contentType).toMatch(/^multipart\/related; boundary=sharlo-school-/);
    expect(createInit.body).toContain(JSON.stringify(record));
    expect(createInit.body).toContain(`"parents":["${PARENT_FOLDER_ID}"]`);
  });

  it('updates the existing file (PATCH, fileId in URL, no parents field) when one already exists for this recordId', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(filesListResponse(['file-123']))
      .mockResolvedValueOnce(jsonResponse({}));
    _configureSchoolContainerStoreForTests({ fetchImpl: fetchMock });

    await putSealedRecord(PARENT_FOLDER_ID, makeRecord());

    const [updateUrl, updateInit] = fetchMock.mock.calls[1];
    expect(updateUrl).toBe(
      'https://www.googleapis.com/upload/drive/v3/files/file-123?uploadType=multipart&supportsAllDrives=true',
    );
    expect(updateInit.method).toBe('PATCH');
    expect(updateInit.body).not.toContain('"parents"');
  });
});

describe('getSealedRecord', () => {
  it('returns the decoded sealed record for an existing recordId', async () => {
    const record = makeRecord();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(filesListResponse(['file-123']))
      .mockResolvedValueOnce(jsonResponse(record));
    _configureSchoolContainerStoreForTests({ fetchImpl: fetchMock });

    const result = await getSealedRecord(PARENT_FOLDER_ID, 'record-1');

    expect(result).toEqual(record);
    const [contentUrl] = fetchMock.mock.calls[1];
    expect(contentUrl).toBe(
      'https://www.googleapis.com/drive/v3/files/file-123?alt=media&supportsAllDrives=true',
    );
  });

  it('returns undefined without a second request when no file matches', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(filesListResponse([]));
    _configureSchoolContainerStoreForTests({ fetchImpl: fetchMock });

    const result = await getSealedRecord(PARENT_FOLDER_ID, 'does-not-exist');

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('listSealedRecordsByType', () => {
  it("queries by parent folder + type appProperty, then fetches each match's content", async () => {
    const a = makeRecord({ recordId: 'a' });
    const b = makeRecord({ recordId: 'b' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(filesListResponse(['file-a', 'file-b']))
      .mockResolvedValueOnce(jsonResponse(a))
      .mockResolvedValueOnce(jsonResponse(b));
    _configureSchoolContainerStoreForTests({ fetchImpl: fetchMock });

    const result = await listSealedRecordsByType(PARENT_FOLDER_ID, 'schoolExamResults');

    expect(result.map((r) => r.recordId).sort()).toEqual(['a', 'b']);
    const [listUrl] = fetchMock.mock.calls[0];
    expect(decodeQuery(listUrl)).toContain(`'${PARENT_FOLDER_ID}' in parents`);
    expect(decodeQuery(listUrl)).toContain("key='type' and value='schoolExamResults'");
  });

  it('escapes a literal single quote in the parent folder id and type', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(filesListResponse([]));
    _configureSchoolContainerStoreForTests({ fetchImpl: fetchMock });

    await listSealedRecordsByType("weird'folder", "weird'type");

    const [listUrl] = fetchMock.mock.calls[0];
    expect(decodeQuery(listUrl)).toContain("'weird\\'folder' in parents");
    expect(decodeQuery(listUrl)).toContain("value='weird\\'type'");
  });
});

describe('error handling', () => {
  it('throws a clear error when a Drive request fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'invalid_token' });
    _configureSchoolContainerStoreForTests({ fetchImpl: fetchMock });

    await expect(getSealedRecord(PARENT_FOLDER_ID, 'record-1')).rejects.toThrow(/401/);
  });
});

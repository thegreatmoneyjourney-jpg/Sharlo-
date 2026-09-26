import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _configureDriveEnvelopeStoreForTests,
  _resetDriveEnvelopeStoreForTests,
  deleteEnvelope,
  getEnvelope,
  listAllEnvelopes,
  listEnvelopesByType,
  putEnvelope,
} from './drive-envelope-store';
import type { StoredEnvelope } from './local-envelope-store';

function makeEnvelope(overrides: Partial<StoredEnvelope> = {}): StoredEnvelope {
  return {
    schemaVersion: 1,
    type: 'examResults',
    recordId: 'record-1',
    ciphertext: 'opaque-ciphertext-blob',
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
  _configureDriveEnvelopeStoreForTests({ getAccessToken: async () => 'test-access-token' });
});

afterEach(() => {
  _resetDriveEnvelopeStoreForTests();
});

describe('putEnvelope', () => {
  it('creates a new file (POST, no fileId in the URL) when none exists yet for this recordId', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(filesListResponse([]))
      .mockResolvedValueOnce(jsonResponse({}));
    _configureDriveEnvelopeStoreForTests({
      fetchImpl: fetchMock,
      getAccessToken: async () => 'tok',
    });

    const envelope = makeEnvelope();
    await putEnvelope(envelope);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [findUrl] = fetchMock.mock.calls[0];
    expect(decodeQuery(findUrl)).toContain("value='record-1'");

    const [createUrl, createInit] = fetchMock.mock.calls[1];
    expect(createUrl).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
    expect(createInit.method).toBe('POST');
    expect(createInit.headers.Authorization).toBe('Bearer tok');
    const contentType = createInit.headers['Content-Type'] as string;
    expect(contentType).toMatch(/^multipart\/related; boundary=sharlo-envelope-/);
    const boundary = contentType.split('boundary=')[1];
    expect(createInit.body).toContain(`--${boundary}`);
    expect(createInit.body).toContain(JSON.stringify(envelope));
    expect(createInit.body).toContain('"recordId":"record-1"');
    expect(createInit.body.trim().endsWith(`--${boundary}--`)).toBe(true);
  });

  it('updates the existing file (PATCH, fileId in the URL) when one already exists for this recordId', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(filesListResponse(['file-123']))
      .mockResolvedValueOnce(jsonResponse({}));
    _configureDriveEnvelopeStoreForTests({ fetchImpl: fetchMock });

    await putEnvelope(makeEnvelope());

    const [updateUrl, updateInit] = fetchMock.mock.calls[1];
    expect(updateUrl).toBe(
      'https://www.googleapis.com/upload/drive/v3/files/file-123?uploadType=multipart',
    );
    expect(updateInit.method).toBe('PATCH');
  });
});

describe('getEnvelope', () => {
  it('returns the decoded envelope for an existing recordId', async () => {
    const envelope = makeEnvelope();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(filesListResponse(['file-123']))
      .mockResolvedValueOnce(jsonResponse(envelope));
    _configureDriveEnvelopeStoreForTests({ fetchImpl: fetchMock });

    const result = await getEnvelope('record-1');

    expect(result).toEqual(envelope);
    const [contentUrl] = fetchMock.mock.calls[1];
    expect(contentUrl).toBe('https://www.googleapis.com/drive/v3/files/file-123?alt=media');
  });

  it('returns undefined without a second request when no file matches', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(filesListResponse([]));
    _configureDriveEnvelopeStoreForTests({ fetchImpl: fetchMock });

    const result = await getEnvelope('does-not-exist');

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('deleteEnvelope', () => {
  it('sends a DELETE for the matching fileId', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(filesListResponse(['file-123']))
      .mockResolvedValueOnce(jsonResponse({}));
    _configureDriveEnvelopeStoreForTests({ fetchImpl: fetchMock });

    await deleteEnvelope('record-1');

    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1];
    expect(deleteUrl).toBe('https://www.googleapis.com/drive/v3/files/file-123');
    expect(deleteInit.method).toBe('DELETE');
  });

  it('is a no-op (no second request) when no file matches', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(filesListResponse([]));
    _configureDriveEnvelopeStoreForTests({ fetchImpl: fetchMock });

    await expect(deleteEnvelope('does-not-exist')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('listEnvelopesByType / listAllEnvelopes', () => {
  it("listEnvelopesByType queries by the type appProperty, then fetches each match's content", async () => {
    const a = makeEnvelope({ recordId: 'a' });
    const b = makeEnvelope({ recordId: 'b' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(filesListResponse(['file-a', 'file-b']))
      .mockResolvedValueOnce(jsonResponse(a))
      .mockResolvedValueOnce(jsonResponse(b));
    _configureDriveEnvelopeStoreForTests({ fetchImpl: fetchMock });

    const result = await listEnvelopesByType('examResults');

    expect(result.map((e) => e.recordId).sort()).toEqual(['a', 'b']);
    const [listUrl] = fetchMock.mock.calls[0];
    expect(decodeQuery(listUrl)).toContain("key='type' and value='examResults'");
  });

  it('listAllEnvelopes queries only by trashed=false, with no type filter', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(filesListResponse([]));
    _configureDriveEnvelopeStoreForTests({ fetchImpl: fetchMock });

    await listAllEnvelopes();

    const [listUrl] = fetchMock.mock.calls[0];
    expect(decodeQuery(listUrl)).toBe('trashed=false');
  });

  it('escapes a literal single quote in a query value', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(filesListResponse([]));
    _configureDriveEnvelopeStoreForTests({ fetchImpl: fetchMock });

    await listEnvelopesByType("weird'type");

    const [listUrl] = fetchMock.mock.calls[0];
    expect(decodeQuery(listUrl)).toContain("value='weird\\'type'");
  });
});

describe('error handling', () => {
  it('throws a clear error when a Drive request fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'invalid_token' });
    _configureDriveEnvelopeStoreForTests({ fetchImpl: fetchMock });

    await expect(getEnvelope('record-1')).rejects.toThrow(/401/);
  });
});

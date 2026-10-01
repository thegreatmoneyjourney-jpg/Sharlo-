import { afterEach, describe, expect, it, vi } from 'vitest';
import { _configureDriveFetchForTests, _resetDriveFetchForTests } from './drive-fetch';
import { createSchoolFolder } from './school-folder';

afterEach(() => {
  _resetDriveFetchForTests();
});

describe('createSchoolFolder', () => {
  it('POSTs a folder-mimeType file named after the school and returns its id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'folder-abc-123' }) });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    const folderId = await createSchoolFolder('Riverside Academy');

    expect(folderId).toBe('folder-abc-123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      name: 'Sharlo — Riverside Academy',
      mimeType: 'application/vnd.google-apps.folder',
    });
  });

  it('propagates a Drive API failure rather than returning a partial id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, text: async () => 'insufficient scope' });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    await expect(createSchoolFolder('Riverside Academy')).rejects.toThrow(/403/);
  });
});

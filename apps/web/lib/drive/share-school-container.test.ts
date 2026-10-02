import { afterEach, describe, expect, it, vi } from 'vitest';
import { _configureDriveFetchForTests, _resetDriveFetchForTests } from './drive-fetch';
import { shareSchoolContainer } from './share-school-container';

afterEach(() => {
  _resetDriveFetchForTests();
});

describe('shareSchoolContainer', () => {
  it("POSTs a writer permission for the teacher's email, with supportsAllDrives", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    await shareSchoolContainer('drive-id-123', 'teacher@example.com');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/drive-id-123/permissions?supportsAllDrives=true',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ role: 'writer', type: 'user', emailAddress: 'teacher@example.com' });
  });

  it('propagates a Drive API failure rather than swallowing it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, text: async () => 'insufficient scope' });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    await expect(shareSchoolContainer('drive-id-123', 'teacher@example.com')).rejects.toThrow(
      /403/,
    );
  });
});

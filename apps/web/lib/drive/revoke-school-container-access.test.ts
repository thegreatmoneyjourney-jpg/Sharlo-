import { afterEach, describe, expect, it, vi } from 'vitest';
import { _configureDriveFetchForTests, _resetDriveFetchForTests } from './drive-fetch';
import { revokeSchoolContainerAccess } from './revoke-school-container-access';

afterEach(() => {
  _resetDriveFetchForTests();
});

describe('revokeSchoolContainerAccess', () => {
  it("finds the teacher's permission by email, then deletes it", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/permissions?')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: [
              { id: 'perm-admin', emailAddress: 'admin@example.com' },
              { id: 'perm-teacher', emailAddress: 'teacher@example.com' },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 204 });
    });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    await revokeSchoolContainerAccess('container-id-123', 'teacher@example.com');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/container-id-123/permissions?supportsAllDrives=true&fields=permissions(id%2CemailAddress)',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/container-id-123/permissions/perm-teacher?supportsAllDrives=true',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('is a no-op when the teacher has no permission on the container', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        permissions: [{ id: 'perm-admin', emailAddress: 'admin@example.com' }],
      }),
    });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    await revokeSchoolContainerAccess('container-id-123', 'teacher@example.com');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates a Drive API failure from the delete call rather than swallowing it', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/permissions?')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: [{ id: 'perm-teacher', emailAddress: 'teacher@example.com' }],
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 403, text: async () => 'insufficient scope' });
    });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    await expect(
      revokeSchoolContainerAccess('container-id-123', 'teacher@example.com'),
    ).rejects.toThrow(/403/);
  });
});

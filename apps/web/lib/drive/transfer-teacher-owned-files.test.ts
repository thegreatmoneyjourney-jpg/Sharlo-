import { afterEach, describe, expect, it, vi } from 'vitest';
import { _configureDriveFetchForTests, _resetDriveFetchForTests } from './drive-fetch';
import { attemptOwnershipTransferForDepartingTeacher } from './transfer-teacher-owned-files';

afterEach(() => {
  _resetDriveFetchForTests();
});

function mockListResponse(files: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ files }) };
}

describe('attemptOwnershipTransferForDepartingTeacher', () => {
  it("upgrades the admin's existing permission to owner for each teacher-owned file", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/files?')) {
        return Promise.resolve(
          mockListResponse([
            {
              id: 'file-1',
              name: 'Exam key.pdf',
              permissions: [
                { id: 'perm-admin', emailAddress: 'admin@example.com' },
                { id: 'perm-teacher', emailAddress: 'teacher@example.com' },
              ],
            },
          ]),
        );
      }
      return Promise.resolve({ ok: true, status: 200 });
    });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    const results = await attemptOwnershipTransferForDepartingTeacher(
      'folder-id-123',
      'teacher@example.com',
      'admin@example.com',
    );

    expect(results).toEqual([
      { fileId: 'file-1', fileName: 'Exam key.pdf', outcome: 'transferred' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/file-1/permissions/perm-admin?transferOwnership=true&supportsAllDrives=true',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'owner' }) }),
    );
  });

  it('reports transfer_failed when the admin has no existing permission entry on the file', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockListResponse([
        {
          id: 'file-1',
          name: 'Exam key.pdf',
          permissions: [{ id: 'perm-teacher', emailAddress: 'teacher@example.com' }],
        },
      ]),
    );
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    const results = await attemptOwnershipTransferForDepartingTeacher(
      'folder-id-123',
      'teacher@example.com',
      'admin@example.com',
    );

    expect(results).toEqual([
      {
        fileId: 'file-1',
        fileName: 'Exam key.pdf',
        outcome: 'transfer_failed',
        error: 'The admin has no existing permission entry on this file to upgrade to owner.',
      },
    ]);
  });

  it('catches a Drive API failure on the transfer call into transfer_failed rather than throwing', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/files?')) {
        return Promise.resolve(
          mockListResponse([
            {
              id: 'file-1',
              name: 'Exam key.pdf',
              permissions: [{ id: 'perm-admin', emailAddress: 'admin@example.com' }],
            },
          ]),
        );
      }
      return Promise.resolve({
        ok: false,
        status: 403,
        text: async () => 'Consent is required to transfer ownership',
      });
    });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    const results = await attemptOwnershipTransferForDepartingTeacher(
      'folder-id-123',
      'teacher@example.com',
      'admin@example.com',
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('transfer_failed');
    expect(results[0]!.error).toMatch(/403/);
  });

  it('returns an empty result when the teacher owns no files in the folder (e.g. the Shared Drive path)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockListResponse([]));
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    const results = await attemptOwnershipTransferForDepartingTeacher(
      'folder-id-123',
      'teacher@example.com',
      'admin@example.com',
    );

    expect(results).toEqual([]);
  });

  it("queries by the teacher's ownership and the folder, scoped across all drives", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockListResponse([]));
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token' });

    await attemptOwnershipTransferForDepartingTeacher(
      'folder-id-123',
      'teacher@example.com',
      'admin@example.com',
    );

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain('supportsAllDrives=true');
    expect(url).toContain('includeItemsFromAllDrives=true');
    const decodedQuery = decodeURIComponent(url.split('?q=')[1]!.split('&')[0]!);
    expect(decodedQuery).toBe(
      "'folder-id-123' in parents and trashed=false and 'teacher@example.com' in owners",
    );
  });
});

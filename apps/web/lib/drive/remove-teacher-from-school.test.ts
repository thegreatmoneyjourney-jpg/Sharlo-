import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTeacherFromSchool } from './remove-teacher-from-school';

const {
  fetchAccountInfoMock,
  submitRemoveTeacherMock,
  attemptOwnershipTransferMock,
  revokeSchoolContainerAccessMock,
} = vi.hoisted(() => ({
  fetchAccountInfoMock: vi.fn(),
  submitRemoveTeacherMock: vi.fn(),
  attemptOwnershipTransferMock: vi.fn(),
  revokeSchoolContainerAccessMock: vi.fn(),
}));

vi.mock('../api/account-client', () => ({ fetchAccountInfo: fetchAccountInfoMock }));
vi.mock('../api/schools-client', () => ({ submitRemoveTeacher: submitRemoveTeacherMock }));
vi.mock('./transfer-teacher-owned-files', () => ({
  attemptOwnershipTransferForDepartingTeacher: attemptOwnershipTransferMock,
}));
vi.mock('./revoke-school-container-access', () => ({
  revokeSchoolContainerAccess: revokeSchoolContainerAccessMock,
}));

const SCHOOL_FOLDER = {
  id: 'school-1',
  driveLocationType: 'folder' as const,
  driveLocationId: 'folder-abc',
};
const SCHOOL_SHARED_DRIVE = {
  id: 'school-1',
  driveLocationType: 'shared_drive' as const,
  driveLocationId: 'drive-abc',
};
const MEMBER = { id: 'member-1', email: 'teacher@example.com' };

beforeEach(() => {
  fetchAccountInfoMock
    .mockReset()
    .mockResolvedValue({ authMode: 'google', email: 'admin@example.com' });
  submitRemoveTeacherMock.mockReset().mockResolvedValue(true);
  attemptOwnershipTransferMock.mockReset().mockResolvedValue([]);
  revokeSchoolContainerAccessMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('removeTeacherFromSchool', () => {
  it('on the folder path: attempts transfer, then revokes, then deletes the membership row, in that order', async () => {
    const callOrder: string[] = [];
    attemptOwnershipTransferMock.mockImplementation(async () => {
      callOrder.push('transfer');
      return [];
    });
    revokeSchoolContainerAccessMock.mockImplementation(async () => {
      callOrder.push('revoke');
    });
    submitRemoveTeacherMock.mockImplementation(async () => {
      callOrder.push('delete');
      return true;
    });

    const outcome = await removeTeacherFromSchool(SCHOOL_FOLDER, MEMBER);

    expect(callOrder).toEqual(['transfer', 'revoke', 'delete']);
    expect(attemptOwnershipTransferMock).toHaveBeenCalledWith(
      'folder-abc',
      'teacher@example.com',
      'admin@example.com',
    );
    expect(revokeSchoolContainerAccessMock).toHaveBeenCalledWith(
      'folder-abc',
      'teacher@example.com',
    );
    expect(submitRemoveTeacherMock).toHaveBeenCalledWith('school-1', 'member-1');
    expect(outcome).toEqual({ transferResults: [], removed: true });
  });

  it('on the Shared Drive path: never attempts transfer, only revokes then deletes', async () => {
    const outcome = await removeTeacherFromSchool(SCHOOL_SHARED_DRIVE, MEMBER);

    expect(attemptOwnershipTransferMock).not.toHaveBeenCalled();
    expect(revokeSchoolContainerAccessMock).toHaveBeenCalledWith(
      'drive-abc',
      'teacher@example.com',
    );
    expect(outcome).toEqual({ transferResults: null, removed: true });
  });

  it('surfaces a failed-transfer outcome rather than swallowing it', async () => {
    attemptOwnershipTransferMock.mockResolvedValue([
      {
        fileId: 'f1',
        fileName: 'Exam key.pdf',
        outcome: 'transfer_failed',
        error: '403 Consent is required',
      },
    ]);

    const outcome = await removeTeacherFromSchool(SCHOOL_FOLDER, MEMBER);

    expect(outcome.transferResults).toEqual([
      {
        fileId: 'f1',
        fileName: 'Exam key.pdf',
        outcome: 'transfer_failed',
        error: '403 Consent is required',
      },
    ]);
    expect(outcome.removed).toBe(true);
  });

  it('does not delete the membership row if revoking access throws', async () => {
    revokeSchoolContainerAccessMock.mockRejectedValue(new Error('network error'));

    await expect(removeTeacherFromSchool(SCHOOL_FOLDER, MEMBER)).rejects.toThrow('network error');

    expect(submitRemoveTeacherMock).not.toHaveBeenCalled();
  });

  it('reports removed: false when the membership row was already gone', async () => {
    submitRemoveTeacherMock.mockResolvedValue(false);

    const outcome = await removeTeacherFromSchool(SCHOOL_SHARED_DRIVE, MEMBER);

    expect(outcome.removed).toBe(false);
  });
});

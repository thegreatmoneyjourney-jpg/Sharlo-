import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncExamResultsToSchool } from './school-result-sync';
import type { ExamResults } from './exam-results';
import type { MyMembership } from '../api/schools-client';

const { fetchMyMembershipMock, sealExamResultsForSchoolMock, putSealedRecordMock } = vi.hoisted(
  () => ({
    fetchMyMembershipMock: vi.fn(),
    sealExamResultsForSchoolMock: vi.fn(),
    putSealedRecordMock: vi.fn(),
  }),
);

vi.mock('../api/schools-client', () => ({ fetchMyMembership: fetchMyMembershipMock }));
vi.mock('./exam-results', () => ({ sealExamResultsForSchool: sealExamResultsForSchoolMock }));
vi.mock('../storage/school-container-store', () => ({ putSealedRecord: putSealedRecordMock }));

const GRANTED_MEMBERSHIP: MyMembership = {
  id: 'member-1',
  schoolId: 'school-1',
  driveLocationType: 'folder',
  driveLocationId: 'folder-abc',
  driveAccessGranted: true,
  adminX25519PublicKey: 'admin-public-key-hex',
};

const EXAM: ExamResults = {
  recordId: 'exam-1',
  title: 'Midterm',
  questionCount: 20,
  key: [],
  rosterId: null,
  students: [],
  createdAt: '2026-10-02T00:00:00.000Z',
};

const FAKE_SEALED = {
  schemaVersion: 1,
  type: 'schoolExamResults',
  recordId: 'exam-1',
  sealedCiphertext: 'x',
};

beforeEach(() => {
  fetchMyMembershipMock.mockReset();
  sealExamResultsForSchoolMock.mockReset().mockResolvedValue(FAKE_SEALED);
  putSealedRecordMock.mockReset().mockResolvedValue(undefined);
});

describe('syncExamResultsToSchool', () => {
  it('reports not attempted when the teacher has no school membership at all', async () => {
    fetchMyMembershipMock.mockResolvedValue(null);

    const result = await syncExamResultsToSchool(EXAM);

    expect(result).toEqual({ attempted: false });
    expect(sealExamResultsForSchoolMock).not.toHaveBeenCalled();
    expect(putSealedRecordMock).not.toHaveBeenCalled();
  });

  it('reports not attempted when the teacher is a member but has not completed the Picker step', async () => {
    fetchMyMembershipMock.mockResolvedValue({ ...GRANTED_MEMBERSHIP, driveAccessGranted: false });

    const result = await syncExamResultsToSchool(EXAM);

    expect(result).toEqual({ attempted: false });
    expect(sealExamResultsForSchoolMock).not.toHaveBeenCalled();
  });

  it('seals and writes the school copy when the teacher has granted Drive access', async () => {
    fetchMyMembershipMock.mockResolvedValue(GRANTED_MEMBERSHIP);

    const result = await syncExamResultsToSchool(EXAM);

    expect(result).toEqual({ attempted: true, ok: true });
    expect(sealExamResultsForSchoolMock).toHaveBeenCalledWith('admin-public-key-hex', EXAM);
    expect(putSealedRecordMock).toHaveBeenCalledWith('folder-abc', FAKE_SEALED);
  });

  it('reports a failed attempt, never throwing, when the membership fetch itself fails', async () => {
    fetchMyMembershipMock.mockRejectedValue(new Error('network error'));

    const result = await syncExamResultsToSchool(EXAM);

    expect(result).toMatchObject({ attempted: true, ok: false });
  });

  it('reports a failed attempt, never throwing, when the Drive write fails', async () => {
    fetchMyMembershipMock.mockResolvedValue(GRANTED_MEMBERSHIP);
    putSealedRecordMock.mockRejectedValue(new Error('Drive API request failed: 500'));

    const result = await syncExamResultsToSchool(EXAM);

    expect(result).toMatchObject({ attempted: true, ok: false });
  });
});

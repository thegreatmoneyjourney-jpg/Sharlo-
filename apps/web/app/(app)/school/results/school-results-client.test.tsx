import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SchoolResultsClient from './school-results-client';
import type { ExamResults } from '@/lib/exams/exam-results';
import type { SchoolSummary } from '@/lib/api/schools-client';

const { fetchMySchoolsMock, loadSchoolWideExamResultsMock } = vi.hoisted(() => ({
  fetchMySchoolsMock: vi.fn(),
  loadSchoolWideExamResultsMock: vi.fn(),
}));

vi.mock('@/lib/api/schools-client', () => ({ fetchMySchools: fetchMySchoolsMock }));
vi.mock('@/lib/exams/school-wide-results', () => ({
  loadSchoolWideExamResults: loadSchoolWideExamResultsMock,
}));

// Same reasoning `exams-list-client.test.tsx` already established: proves
// only this component's own rendering/sorting, not `RequireMasterKey`
// itself (its own dedicated test file covers that).
vi.mock('../../require-master-key', () => ({
  RequireMasterKey: ({ children }: { children: (masterKey: Uint8Array) => React.ReactNode }) =>
    children(new Uint8Array(32)),
}));

const SCHOOL: SchoolSummary = {
  id: 'school-1',
  name: 'Riverside Academy',
  driveLocationType: 'folder',
  driveLocationId: 'folder-abc',
  adminX25519PublicKey: 'fixture-public-key',
  adminX25519WrappedPrivateKey: 'fixture-wrapped-private-key',
};

function exam(overrides: Partial<ExamResults> = {}): ExamResults {
  return {
    recordId: 'e1',
    title: 'Quiz',
    questionCount: 2,
    key: [],
    rosterId: null,
    students: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function scoredStudent(id: number, correctCount: number, incorrectCount: number) {
  return {
    id,
    rollNumber: String(id),
    name: null,
    scored: {
      scores: [],
      correctCount,
      incorrectCount,
      needsReviewCount: 0,
      excludedCount: 0,
    },
  };
}

beforeEach(() => {
  fetchMySchoolsMock.mockReset();
  loadSchoolWideExamResultsMock.mockReset();
});

afterEach(cleanup);

describe('SchoolResultsClient', () => {
  it('prompts to create a school when the admin has none', async () => {
    fetchMySchoolsMock.mockResolvedValue([]);
    render(<SchoolResultsClient />);
    expect(await screen.findByText(/manage a school yet/i)).toBeInTheDocument();
  });

  it('shows a message when the school has no finalized exams yet', async () => {
    fetchMySchoolsMock.mockResolvedValue([SCHOOL]);
    loadSchoolWideExamResultsMock.mockResolvedValue([]);
    render(<SchoolResultsClient />);
    expect(await screen.findByText(/no exams have been finalized/i)).toBeInTheDocument();
  });

  it("fetches with the school's own key material and lists exams newest first, with a computed average", async () => {
    fetchMySchoolsMock.mockResolvedValue([SCHOOL]);
    loadSchoolWideExamResultsMock.mockResolvedValue([
      exam({
        recordId: 'exam-old',
        title: 'Old quiz',
        createdAt: '2026-01-01T00:00:00.000Z',
        students: [scoredStudent(1, 1, 1)], // 50%
      }),
      exam({
        recordId: 'exam-recent',
        title: 'Recent quiz',
        createdAt: '2026-06-01T00:00:00.000Z',
        students: [scoredStudent(1, 2, 0)], // 100%
      }),
    ]);

    render(<SchoolResultsClient />);

    await screen.findByText('Recent quiz');
    expect(loadSchoolWideExamResultsMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'folder-abc',
      'fixture-public-key',
      'fixture-wrapped-private-key',
    );

    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Recent quiz');
    expect(items[0]).toContain('100% average');
    expect(items[1]).toContain('Old quiz');
    expect(items[1]).toContain('50% average');
  });

  it('shows an error message when loading fails', async () => {
    fetchMySchoolsMock.mockResolvedValue([SCHOOL]);
    loadSchoolWideExamResultsMock.mockRejectedValue(new Error('boom'));
    render(<SchoolResultsClient />);
    expect(await screen.findByText(/couldn't load your school's results/i)).toBeInTheDocument();
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExamsListClient from './exams-list-client';
import type { ExamResults } from '@/lib/exams/exam-results';

const { getEnvelopeStoreMock, listExamResultsMock } = vi.hoisted(() => ({
  getEnvelopeStoreMock: vi.fn(),
  listExamResultsMock: vi.fn(),
}));

vi.mock('@/lib/storage/envelope-store', () => ({ getEnvelopeStore: getEnvelopeStoreMock }));
vi.mock('@/lib/exams/exam-results', () => ({ listExamResults: listExamResultsMock }));

// `RequireMasterKey` has its own dedicated test file — mocked here so this
// file only proves ExamsListClient's own rendering/sorting, matching the
// pattern `new-exam-client.test.tsx` already established for the same
// reason.
vi.mock('../require-master-key', () => ({
  RequireMasterKey: ({ children }: { children: (masterKey: Uint8Array) => React.ReactNode }) =>
    children(new Uint8Array(32)),
}));

const FAKE_STORE = { name: 'fake-store' };

function exam(overrides: Partial<ExamResults> = {}): ExamResults {
  return {
    recordId: 'e1',
    title: 'Quiz',
    questionCount: 20,
    key: [],
    rosterId: null,
    students: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  getEnvelopeStoreMock.mockReset().mockResolvedValue(FAKE_STORE);
  listExamResultsMock.mockReset();
});

afterEach(cleanup);

describe('ExamsListClient', () => {
  it('shows a message when there are no saved exams', async () => {
    listExamResultsMock.mockResolvedValue([]);
    render(<ExamsListClient />);
    expect(await screen.findByText(/no saved exams yet/i)).toBeInTheDocument();
  });

  it('lists saved exams, newest first, with a link to each', async () => {
    listExamResultsMock.mockResolvedValue([
      exam({ recordId: 'exam-old', title: 'Old quiz', createdAt: '2026-01-01T00:00:00.000Z' }),
      exam({
        recordId: 'exam-recent',
        title: 'Recent quiz',
        createdAt: '2026-06-01T00:00:00.000Z',
        students: [
          {
            id: 1,
            rollNumber: '1',
            name: null,
            scored: {
              scores: [],
              correctCount: 0,
              incorrectCount: 0,
              needsReviewCount: 0,
              excludedCount: 0,
            },
          },
        ],
      }),
    ]);
    render(<ExamsListClient />);

    await screen.findByText('Recent quiz');
    const examLinks = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.startsWith('/exams/exam-'));
    expect(examLinks.map((l) => l.getAttribute('href'))).toEqual([
      '/exams/exam-recent',
      '/exams/exam-old',
    ]);
    expect(screen.getByText(/1 student/)).toBeInTheDocument();
  });

  it('shows an error message when loading fails', async () => {
    listExamResultsMock.mockRejectedValue(new Error('boom'));
    render(<ExamsListClient />);
    expect(await screen.findByText(/couldn't load your exams/i)).toBeInTheDocument();
  });
});

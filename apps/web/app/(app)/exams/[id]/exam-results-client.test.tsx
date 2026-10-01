import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExamResultsClient from './exam-results-client';
import type { ExamResults } from '@/lib/exams/exam-results';

const { getEnvelopeStoreMock, loadExamResultsMock, saveExamResultsMock, downloadBlobMock } =
  vi.hoisted(() => ({
    getEnvelopeStoreMock: vi.fn(),
    loadExamResultsMock: vi.fn(),
    saveExamResultsMock: vi.fn(),
    downloadBlobMock: vi.fn(),
  }));

vi.mock('@/lib/export/download-file', () => ({ downloadBlob: downloadBlobMock }));
vi.mock('@/lib/storage/envelope-store', () => ({ getEnvelopeStore: getEnvelopeStoreMock }));
vi.mock('@/lib/exams/exam-results', () => ({
  loadExamResults: loadExamResultsMock,
  saveExamResults: saveExamResultsMock,
}));
vi.mock('../../require-master-key', () => ({
  RequireMasterKey: ({ children }: { children: (masterKey: Uint8Array) => React.ReactNode }) =>
    children(new Uint8Array(32)),
}));

const FAKE_STORE = { name: 'fake-store' };

function makeExam(): ExamResults {
  return {
    recordId: 'exam-1',
    title: 'Grade 8 quiz',
    questionCount: 2,
    key: [
      { outcome: 'answered', optionIndex: 0 },
      { outcome: 'answered', optionIndex: 1 },
    ],
    rosterId: null,
    students: [
      {
        id: 1,
        rollNumber: '7',
        name: 'Alice',
        scored: {
          scores: [{ outcome: 'correct' }, { outcome: 'incorrect' }],
          correctCount: 1,
          incorrectCount: 1,
          needsReviewCount: 0,
          excludedCount: 0,
        },
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  getEnvelopeStoreMock.mockReset().mockResolvedValue(FAKE_STORE);
  loadExamResultsMock.mockReset();
  saveExamResultsMock.mockReset().mockResolvedValue(undefined);
  downloadBlobMock.mockReset();
});

afterEach(cleanup);

describe('ExamResultsClient', () => {
  it('shows a not-found message when the exam does not exist', async () => {
    loadExamResultsMock.mockResolvedValue(undefined);
    render(<ExamResultsClient examId="missing" />);
    expect(await screen.findByText(/couldn.t be found/i)).toBeInTheDocument();
  });

  it('shows an error message when loading fails', async () => {
    loadExamResultsMock.mockRejectedValue(new Error('boom'));
    render(<ExamResultsClient examId="exam-1" />);
    expect(await screen.findByText(/couldn't load this exam/i)).toBeInTheDocument();
  });

  it('renders the title, grid, and per-question breakdown once loaded', async () => {
    loadExamResultsMock.mockResolvedValue(makeExam());
    render(<ExamResultsClient examId="exam-1" />);

    expect(await screen.findByText('Grade 8 quiz')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
    expect(screen.getByText(/Q1:.*100% correct/)).toBeInTheDocument();
    expect(screen.getByText(/Q2:.*0% correct/)).toBeInTheDocument();
  });

  it('renders class analytics (hardest questions, weakest students, score distribution) once loaded (M3-009)', async () => {
    loadExamResultsMock.mockResolvedValue(makeExam());
    render(<ExamResultsClient examId="exam-1" />);
    await screen.findByText('Grade 8 quiz');

    // Alice got Q1 right, Q2 wrong -> Q2 is the hardest (0%), Q1 is the easiest (100%).
    expect(screen.getByText(/Q2 — 0% got it right/)).toBeInTheDocument();
    expect(screen.getByText(/Q1 — 100% got it right/)).toBeInTheDocument();
    // Alice is the only (and so "weakest") student, at 1/2 known-answer correct = 50%.
    expect(screen.getByText(/Alice: 50%/)).toBeInTheDocument();
    expect(screen.getByText(/50–60%: 1 student/)).toBeInTheDocument();
  });

  it('"Download CSV" builds and downloads a CSV blob of the exam (M3-010)', async () => {
    loadExamResultsMock.mockResolvedValue(makeExam());
    render(<ExamResultsClient examId="exam-1" />);
    await screen.findByText('Grade 8 quiz');

    fireEvent.click(screen.getByRole('button', { name: /download csv/i }));

    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
    const [blob, filename] = downloadBlobMock.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(filename).toBe('Grade 8 quiz.csv');
    expect(await blob.text()).toContain('Alice');
  });

  it('"Download Excel" shows a busy state and downloads an xlsx blob of the exam (M3-010)', async () => {
    loadExamResultsMock.mockResolvedValue(makeExam());
    render(<ExamResultsClient examId="exam-1" />);
    await screen.findByText('Grade 8 quiz');

    fireEvent.click(screen.getByRole('button', { name: /download excel/i }));
    expect(await screen.findByRole('button', { name: /preparing/i })).toBeDisabled();

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1));
    const [blob, filename] = downloadBlobMock.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(filename).toBe('Grade 8 quiz.xlsx');
    expect(await screen.findByRole('button', { name: /download excel/i })).not.toBeDisabled();
  });

  it('editing a cell re-saves the whole exam with the update applied', async () => {
    loadExamResultsMock.mockResolvedValue(makeExam());
    render(<ExamResultsClient examId="exam-1" />);
    await screen.findByDisplayValue('Alice');

    fireEvent.change(screen.getByLabelText('Student name'), { target: { value: 'Alicia' } });

    await waitFor(() => expect(saveExamResultsMock).toHaveBeenCalledTimes(1));
    const [store, masterKey, savedExam] = saveExamResultsMock.mock.calls[0]!;
    expect(store).toBe(FAKE_STORE);
    expect(masterKey).toBeInstanceOf(Uint8Array);
    expect(savedExam.recordId).toBe('exam-1');
    expect(savedExam.students[0].name).toBe('Alicia');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('shows an error with a retry option when the save fails', async () => {
    loadExamResultsMock.mockResolvedValue(makeExam());
    saveExamResultsMock.mockRejectedValueOnce(new Error('offline'));
    render(<ExamResultsClient examId="exam-1" />);
    await screen.findByDisplayValue('Alice');

    fireEvent.change(screen.getByLabelText('Student name'), { target: { value: 'Alicia' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t save/i);

    saveExamResultsMock.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(saveExamResultsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });
});

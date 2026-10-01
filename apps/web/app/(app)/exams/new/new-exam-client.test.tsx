import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewExamClient from './new-exam-client';
import type { Roster } from '@/lib/roster/roster';

const { examScanFlowMock, rosterPickerMock } = vi.hoisted(() => ({
  examScanFlowMock: vi.fn(),
  rosterPickerMock: vi.fn(),
}));

// ExamScanFlow owns the whole camera/OpenCV pipeline — needs a real
// browser, same rationale scan-client.test.tsx already established for
// mocking out every OpenCV-touching hook. This file only proves the
// setup form's own validation/state, not the scan flow itself (that's
// proven end to end against a real dev server — see
// docs/reports/SHARLO-M2-004.md).
vi.mock('./exam-scan-flow', () => ({
  ExamScanFlow: (props: { examTitle: string }) => {
    examScanFlowMock(props);
    return <div data-testid="exam-scan-flow">{props.examTitle}</div>;
  },
}));

// `RequireMasterKey`/`RosterPicker` each own their own state machine and
// have their own dedicated test files (`require-master-key.test.tsx`,
// `roster-picker.test.tsx`) — mocked here for the same reason
// `ExamScanFlow` is: this file proves only `NewExamClient`'s own toggle/
// wiring, not what's behind it. The stub skips straight to "unlocked"
// with a fake key and exposes a button that simulates picking a roster.
vi.mock('../../require-master-key', () => ({
  RequireMasterKey: ({ children }: { children: (masterKey: Uint8Array) => React.ReactNode }) =>
    children(new Uint8Array(32)),
}));
vi.mock('./roster-picker', () => ({
  RosterPicker: ({ onSelect }: { onSelect: (roster: Roster | null) => void }) => {
    rosterPickerMock();
    return (
      <button
        type="button"
        onClick={() =>
          onSelect({
            recordId: 'c1',
            className: 'Grade 8A',
            entries: [{ rollNumber: '1', studentName: 'Alice' }],
          })
        }
      >
        pick Grade 8A
      </button>
    );
  },
}));

beforeEach(() => {
  examScanFlowMock.mockReset();
  rosterPickerMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('NewExamClient', () => {
  it('disables "Start" until a title is entered', () => {
    render(<NewExamClient />);
    const startButton = screen.getByRole('button', { name: /start scanning the answer key/i });
    expect(startButton).toBeDisabled();
  });

  it('enables "Start" once a title is entered, and defaults to the smallest template', () => {
    render(<NewExamClient />);
    const titleInput = screen.getByLabelText(/exam title/i);
    fireEvent.change(titleInput, { target: { value: 'Grade 8 quiz' } });

    const startButton = screen.getByRole('button', { name: /start scanning the answer key/i });
    expect(startButton).not.toBeDisabled();
  });

  it('lists all 3 stock templates, with the first selected by default', () => {
    render(<NewExamClient />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(radios[0]!.checked).toBe(true);
    expect(radios[1]!.checked).toBe(false);
    expect(radios[2]!.checked).toBe(false);
  });

  it('passes the entered title and chosen template geometry to ExamScanFlow on Start', () => {
    render(<NewExamClient />);
    const titleInput = screen.getByLabelText(/exam title/i);
    fireEvent.change(titleInput, { target: { value: 'Midterm' } });

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    fireEvent.click(radios[1]!); // 50-question

    fireEvent.click(screen.getByRole('button', { name: /start scanning the answer key/i }));

    expect(screen.getByTestId('exam-scan-flow')).toHaveTextContent('Midterm');
    expect(examScanFlowMock).toHaveBeenCalledTimes(1);
    const passedProps = examScanFlowMock.mock.calls[0]![0];
    expect(passedProps.examTitle).toBe('Midterm');
    expect(passedProps.geometry.questionCount).toBe(50);
  });

  it('passes roster: null to ExamScanFlow when the class-list step is never opened (M3-007)', () => {
    render(<NewExamClient />);
    fireEvent.change(screen.getByLabelText(/exam title/i), { target: { value: 'Midterm' } });
    fireEvent.click(screen.getByRole('button', { name: /start scanning the answer key/i }));

    expect(rosterPickerMock).not.toHaveBeenCalled();
    expect(examScanFlowMock.mock.calls[0]![0].roster).toBeNull();
  });

  it('opting into a class list and picking one passes a roster lookup to ExamScanFlow (M3-007)', () => {
    render(<NewExamClient />);
    fireEvent.change(screen.getByLabelText(/exam title/i), { target: { value: 'Midterm' } });

    fireEvent.click(screen.getByRole('button', { name: /add a class list/i }));
    expect(rosterPickerMock).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /pick grade 8a/i }));

    fireEvent.click(screen.getByRole('button', { name: /start scanning the answer key/i }));

    const roster = examScanFlowMock.mock.calls[0]![0].roster as ReadonlyMap<string, string>;
    expect(roster.get('1')).toBe('Alice');
  });

  it('never claims unattended 100% accuracy anywhere on the setup screen', () => {
    const { container } = render(<NewExamClient />);
    const text = container.textContent?.toLowerCase() ?? '';
    for (const phrase of ['100% accura', 'fully automatic', 'guaranteed accura']) {
      expect(text).not.toContain(phrase);
    }
  });
});

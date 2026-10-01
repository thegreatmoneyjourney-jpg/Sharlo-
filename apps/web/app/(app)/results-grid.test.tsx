import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultsGrid } from './results-grid';
import type { StudentResult } from '@/lib/exams/exam-results';

afterEach(cleanup);

function makeStudent(overrides: Partial<StudentResult> = {}): StudentResult {
  return {
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
    ...overrides,
  };
}

describe('ResultsGrid', () => {
  it('renders one row per student, with question-count columns', () => {
    render(<ResultsGrid students={[makeStudent()]} questionCount={2} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
    expect(screen.getByDisplayValue('7')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Q1' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Q2' })).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('calls onChange with the updated name on edit', () => {
    const onChange = vi.fn();
    render(<ResultsGrid students={[makeStudent()]} questionCount={2} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Student name'), { target: { value: 'Alicia' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0][0]).toMatchObject({ name: 'Alicia' });
  });

  it('calls onChange with the updated roll number on edit', () => {
    const onChange = vi.fn();
    render(<ResultsGrid students={[makeStudent()]} questionCount={2} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Roll number'), { target: { value: '42' } });

    expect(onChange.mock.calls[0]![0][0]).toMatchObject({ rollNumber: '42' });
  });

  it('changing a question select re-tallies that student', () => {
    const onChange = vi.fn();
    render(<ResultsGrid students={[makeStudent()]} questionCount={2} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Question 2 outcome'), {
      target: { value: 'correct' },
    });

    const updated = onChange.mock.calls[0]![0][0];
    expect(updated.scored.correctCount).toBe(2);
    expect(updated.scored.incorrectCount).toBe(0);
  });

  it('"Add student" appends a blank row', () => {
    const onChange = vi.fn();
    render(<ResultsGrid students={[makeStudent()]} questionCount={2} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /add student/i }));

    const updated = onChange.mock.calls[0]![0];
    expect(updated).toHaveLength(2);
    expect(updated[1].name).toBeNull();
  });

  it('"Remove" deletes that row', () => {
    const onChange = vi.fn();
    const students = [makeStudent({ id: 1 }), makeStudent({ id: 2, name: 'Bob' })];
    render(<ResultsGrid students={students} questionCount={2} onChange={onChange} />);

    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]!);

    const updated = onChange.mock.calls[0]![0];
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe('Bob');
  });
});

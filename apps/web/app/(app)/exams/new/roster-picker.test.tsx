import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RosterPicker } from './roster-picker';
import type { Roster } from '@/lib/roster/roster';

const { getEnvelopeStoreMock, listRostersMock, saveRosterMock } = vi.hoisted(() => ({
  getEnvelopeStoreMock: vi.fn(),
  listRostersMock: vi.fn(),
  saveRosterMock: vi.fn(),
}));

vi.mock('@/lib/storage/envelope-store', () => ({ getEnvelopeStore: getEnvelopeStoreMock }));
vi.mock('@/lib/roster/roster-store', () => ({
  listRosters: listRostersMock,
  saveRoster: saveRosterMock,
}));

const FAKE_STORE = { name: 'fake-store' };
const MASTER_KEY = new Uint8Array(32);

const ROSTER_A: Roster = {
  recordId: 'class-a',
  className: 'Grade 8A',
  entries: [{ rollNumber: '1', studentName: 'Alice' }],
};

function csvFile(content: string): File {
  return new File([content], 'roster.csv', { type: 'text/csv' });
}

beforeEach(() => {
  getEnvelopeStoreMock.mockReset().mockResolvedValue(FAKE_STORE);
  listRostersMock.mockReset().mockResolvedValue([ROSTER_A]);
  saveRosterMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('RosterPicker', () => {
  it('loads and lists existing classes', async () => {
    render(<RosterPicker masterKey={MASTER_KEY} onSelect={vi.fn()} />);
    await waitFor(() => expect(listRostersMock).toHaveBeenCalledWith(FAKE_STORE, MASTER_KEY));
    expect(await screen.findByText(/grade 8a \(1\)/i)).toBeInTheDocument();
  });

  it('shows an error message if loading fails', async () => {
    listRostersMock.mockRejectedValue(new Error('boom'));
    render(<RosterPicker masterKey={MASTER_KEY} onSelect={vi.fn()} />);
    expect(await screen.findByText(/couldn't load your class lists/i)).toBeInTheDocument();
  });

  it('calls onSelect with the matching roster when an existing class is picked', async () => {
    const onSelect = vi.fn();
    render(<RosterPicker masterKey={MASTER_KEY} onSelect={onSelect} />);
    await screen.findByText(/grade 8a/i);

    fireEvent.change(screen.getByLabelText(/^class$/i), { target: { value: 'class-a' } });

    expect(onSelect).toHaveBeenCalledWith(ROSTER_A);
  });

  it('calls onSelect with null when "None" is (re-)selected', async () => {
    const onSelect = vi.fn();
    render(<RosterPicker masterKey={MASTER_KEY} onSelect={onSelect} />);
    await screen.findByText(/grade 8a/i);

    const select = screen.getByLabelText(/^class$/i);
    fireEvent.change(select, { target: { value: 'class-a' } });
    fireEvent.change(select, { target: { value: '' } });

    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('uploads a new class list: parses the CSV, previews it, and saves under a fresh recordId', async () => {
    const onSelect = vi.fn();
    render(<RosterPicker masterKey={MASTER_KEY} onSelect={onSelect} />);
    await screen.findByText(/grade 8a/i);

    fireEvent.click(screen.getByRole('button', { name: /upload a new class list/i }));
    fireEvent.change(screen.getByLabelText(/class name/i), { target: { value: 'Grade 9B' } });
    fireEvent.change(screen.getByLabelText(/class list csv/i), {
      target: { files: [csvFile('1,Alice\n2,Bob')] },
    });

    expect(await screen.findByText(/2 students found/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save class list/i }));

    await waitFor(() => expect(saveRosterMock).toHaveBeenCalledTimes(1));
    const [store, masterKey, savedRoster] = saveRosterMock.mock.calls[0]!;
    expect(store).toBe(FAKE_STORE);
    expect(masterKey).toBe(MASTER_KEY);
    expect(savedRoster).toMatchObject({
      className: 'Grade 9B',
      entries: [
        { rollNumber: '1', studentName: 'Alice' },
        { rollNumber: '2', studentName: 'Bob' },
      ],
    });
    expect(savedRoster.recordId).not.toBe(ROSTER_A.recordId);
    expect(onSelect).toHaveBeenCalledWith(savedRoster);
  });

  it('shows row-level CSV errors without blocking the valid rows from saving', async () => {
    render(<RosterPicker masterKey={MASTER_KEY} onSelect={vi.fn()} />);
    await screen.findByText(/grade 8a/i);

    fireEvent.click(screen.getByRole('button', { name: /upload a new class list/i }));
    fireEvent.change(screen.getByLabelText(/class list csv/i), {
      target: { files: [csvFile('1,Alice\nbad,Bob')] },
    });

    expect(await screen.findByText(/1 student found/i)).toBeInTheDocument();
    expect(screen.getByText(/row 2.*isn't a valid roll number/i)).toBeInTheDocument();
  });

  it('replacing an existing class reuses its recordId and pre-fills the class name', async () => {
    const onSelect = vi.fn();
    render(<RosterPicker masterKey={MASTER_KEY} onSelect={onSelect} />);
    await screen.findByText(/grade 8a/i);

    fireEvent.change(screen.getByLabelText(/^class$/i), { target: { value: 'class-a' } });
    fireEvent.click(screen.getByRole('button', { name: /replace grade 8a.*list/i }));

    expect(screen.getByLabelText(/class name/i)).toHaveValue('Grade 8A');

    fireEvent.change(screen.getByLabelText(/class list csv/i), {
      target: { files: [csvFile('1,Alicia')] },
    });
    await screen.findByText(/1 student found/i);
    fireEvent.click(screen.getByRole('button', { name: /save class list/i }));

    await waitFor(() => expect(saveRosterMock).toHaveBeenCalledTimes(1));
    const [, , savedRoster] = saveRosterMock.mock.calls[0]!;
    expect(savedRoster.recordId).toBe(ROSTER_A.recordId);
    expect(savedRoster.className).toBe('Grade 8A');
    expect(savedRoster.entries).toEqual([{ rollNumber: '1', studentName: 'Alicia' }]);
  });
});

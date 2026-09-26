import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupCard } from './backup-card';

const { createBackupBlobMock, restoreBackupFromFileMock } = vi.hoisted(() => ({
  createBackupBlobMock: vi.fn(),
  restoreBackupFromFileMock: vi.fn(),
}));

vi.mock('@/lib/storage/backup', () => ({
  createBackupBlob: createBackupBlobMock,
  restoreBackupFromFile: restoreBackupFromFileMock,
}));

beforeEach(() => {
  createBackupBlobMock.mockReset();
  restoreBackupFromFileMock.mockReset();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BackupCard', () => {
  it('exports a backup file by creating an object URL and clicking a download link', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    createBackupBlobMock.mockResolvedValue(blob);

    render(<BackupCard />);
    fireEvent.click(screen.getByRole('button', { name: /export backup file/i }));

    await vi.waitFor(() => expect(createBackupBlobMock).toHaveBeenCalled());
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('shows an error if export fails', async () => {
    createBackupBlobMock.mockRejectedValue(new Error('boom'));

    render(<BackupCard />);
    fireEvent.click(screen.getByRole('button', { name: /export backup file/i }));

    await screen.findByText(/could not create a backup file/i);
  });

  it('imports a selected file and reports the restored/skipped counts', async () => {
    restoreBackupFromFileMock.mockResolvedValue({ restored: 3, skipped: 1 });

    render(<BackupCard />);
    const file = new File(['{}'], 'sharlo-backup.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText(/restored 3 records \(1 skipped\)/i);
    expect(restoreBackupFromFileMock).toHaveBeenCalledWith(file);
  });

  it('shows the specific error message when import fails', async () => {
    restoreBackupFromFileMock.mockRejectedValue(
      new Error('That file does not look like a Sharlo backup file.'),
    );

    render(<BackupCard />);
    const file = new File(['{}'], 'garbage.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText(/does not look like a Sharlo backup file/i);
  });
});

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScanClient from './scan-client';

const { loadOpenCvMock } = vi.hoisted(() => ({
  loadOpenCvMock: vi.fn(),
}));

vi.mock('@/lib/scanning/opencv-loader', () => ({
  loadOpenCv: loadOpenCvMock,
}));

afterEach(() => {
  cleanup();
  loadOpenCvMock.mockReset();
});

describe('ScanClient', () => {
  it('shows a loading indicator, then the ready state once OpenCV resolves', async () => {
    let resolveLoad!: () => void;
    loadOpenCvMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveLoad = resolve;
      }),
    );

    render(<ScanClient />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading scanner/i);

    resolveLoad();

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/scanner ready/i)).toBeInTheDocument();
  });

  it('shows an error state if OpenCV fails to load', async () => {
    loadOpenCvMock.mockReturnValue(Promise.reject(new Error('network error')));

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('calls loadOpenCv exactly once per mount', async () => {
    loadOpenCvMock.mockReturnValue(Promise.resolve({ cv: { getBuildInformation: () => 'x' } }));

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.getByText(/scanner ready/i)).toBeInTheDocument();
    });
    expect(loadOpenCvMock).toHaveBeenCalledTimes(1);
  });
});

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScanClient from './scan-client';
import type { CameraState } from './use-camera-stream';

const { loadOpenCvMock, useCameraStreamMock } = vi.hoisted(() => ({
  loadOpenCvMock: vi.fn(),
  useCameraStreamMock: vi.fn(),
}));

vi.mock('@/lib/scanning/opencv-loader', () => ({
  loadOpenCv: loadOpenCvMock,
}));

vi.mock('./use-camera-stream', () => ({
  useCameraStream: useCameraStreamMock,
}));

function mockCamera(state: CameraState, retry = vi.fn()) {
  useCameraStreamMock.mockReturnValue({ state, retry });
}

const OPENCV_READY = Promise.resolve({ cv: { getBuildInformation: () => 'x' } });

afterEach(() => {
  cleanup();
  loadOpenCvMock.mockReset();
  useCameraStreamMock.mockReset();
});

describe('ScanClient', () => {
  it('shows a loading indicator while OpenCV loads, even if the camera is already live', async () => {
    let resolveOpenCv!: () => void;
    loadOpenCvMock.mockReturnValue(new Promise<void>((resolve) => (resolveOpenCv = resolve)));
    mockCamera({ status: 'live' });

    render(<ScanClient />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading scanner/i);

    resolveOpenCv();

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('shows a loading indicator while the camera is still requesting, even if OpenCV is ready', () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'requesting' });

    render(<ScanClient />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading scanner/i);
  });

  it('shows the live video preview once both OpenCV and the camera are ready', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
    expect(document.querySelector('video')).toBeInTheDocument();
  });

  it('shows the OpenCV error state if OpenCV fails to load', async () => {
    loadOpenCvMock.mockReturnValue(Promise.reject(new Error('network error')));
    mockCamera({ status: 'requesting' });

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load the scanner/i);
    });
  });

  it('shows a permission-denied message with a working retry button', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    const retry = vi.fn();
    mockCamera({ status: 'error', reason: 'permission-denied' }, retry);

    render(<ScanClient />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/camera access was denied/i);
    const retryButton = screen.getByRole('button', { name: /try again/i });

    retryButton.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows an unsupported-browser message with no retry button', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'error', reason: 'unsupported' });

    render(<ScanClient />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/doesn.t support camera access/i);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});

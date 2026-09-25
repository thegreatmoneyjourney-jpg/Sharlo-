import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScanClient from './scan-client';
import type { CameraState } from './use-camera-stream';

const { loadOpenCvMock, useCameraStreamMock, useCornerDetectionMock } = vi.hoisted(() => ({
  loadOpenCvMock: vi.fn(),
  useCameraStreamMock: vi.fn(),
  useCornerDetectionMock: vi.fn(),
}));

vi.mock('@/lib/scanning/opencv-loader', () => ({
  loadOpenCv: loadOpenCvMock,
}));

vi.mock('./use-camera-stream', () => ({
  useCameraStream: useCameraStreamMock,
}));

// The real hook calls into OpenCV's ArUco detector, which needs actual
// WASM execution in a browser — can't run in jsdom (see
// docs/reports/SHARLO-M1-003.md). ScanClient's own tests only need to
// verify it renders/composes correctly, not that detection itself
// works, so this stays a harmless no-op unless a test overrides it.
vi.mock('./use-corner-detection', () => ({
  useCornerDetection: useCornerDetectionMock,
}));

function mockCamera(state: CameraState, retry = vi.fn()) {
  useCameraStreamMock.mockReturnValue({ state, retry });
}

const OPENCV_READY = Promise.resolve({ cv: { getBuildInformation: () => 'x' } });

beforeEach(() => {
  useCornerDetectionMock.mockReturnValue({ result: null, measuredFps: null });
});

afterEach(() => {
  cleanup();
  loadOpenCvMock.mockReset();
  useCameraStreamMock.mockReset();
  useCornerDetectionMock.mockReset();
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

  it('only activates corner detection once both OpenCV and the camera are ready', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });

    render(<ScanClient />);

    await waitFor(() => {
      expect(document.querySelector('video')).toBeInTheDocument();
    });
    // Called at least once with active=true — the useEffect dependency
    // change (loading -> ready) may also produce an earlier false call.
    expect(useCornerDetectionMock).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('shows the measured fps once corner detection reports one', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useCornerDetectionMock.mockReturnValue({ result: null, measuredFps: 11.7 });

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.getByText('11.7 fps')).toBeInTheDocument();
    });
  });

  it('does not show an fps readout before corner detection has measured one', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useCornerDetectionMock.mockReturnValue({ result: null, measuredFps: null });

    render(<ScanClient />);

    await waitFor(() => {
      expect(document.querySelector('video')).toBeInTheDocument();
    });
    expect(screen.queryByText(/fps/)).not.toBeInTheDocument();
  });
});

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScanClient from './scan-client';
import type { CameraState } from './use-camera-stream';
import type { CapturedFrame } from './use-auto-capture';

// jsdom doesn't reliably provide a working ImageData constructor, and
// scan-client's thumbnail effect never actually reads pixel data in
// tests anyway (canvas.getContext('2d') is null in jsdom) — a plain
// stand-in with the right shape is enough for this fixture.
const FAKE_CAPTURED_FRAME = {
  imageData: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
  corners: {},
  capturedAt: 1000,
} as unknown as CapturedFrame;

const {
  loadOpenCvMock,
  useCameraStreamMock,
  useCornerDetectionMock,
  useAutoCaptureMock,
  useManualCaptureMock,
  useDewarpMock,
} = vi.hoisted(() => ({
  loadOpenCvMock: vi.fn(),
  useCameraStreamMock: vi.fn(),
  useCornerDetectionMock: vi.fn(),
  useAutoCaptureMock: vi.fn(),
  useManualCaptureMock: vi.fn(),
  useDewarpMock: vi.fn(),
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

// Same rationale as use-corner-detection above: the real gate is plain
// TypeScript and could run in jsdom, but it's driven off a captured
// <video> frame via canvas, which still needs the real detection loop
// wired through. See docs/reports/SHARLO-M1-004.md.
vi.mock('./use-auto-capture', () => ({
  useAutoCapture: useAutoCaptureMock,
}));

// Same rationale again: the real hook calls playCaptureFeedback and
// captureVideoFrame against a real <video>/canvas. See
// docs/reports/SHARLO-M1-008.md.
vi.mock('./use-manual-capture', () => ({
  useManualCapture: useManualCaptureMock,
}));

// Same rationale again: the real hook runs cv.warpPerspective against a
// real captured frame, needs a real browser. See
// docs/reports/SHARLO-M1-005.md.
vi.mock('./use-dewarp', () => ({
  useDewarp: useDewarpMock,
}));

function mockCamera(state: CameraState, retry = vi.fn()) {
  useCameraStreamMock.mockReturnValue({ state, retry });
}

const OPENCV_READY = Promise.resolve({ cv: { getBuildInformation: () => 'x' } });

beforeEach(() => {
  useCornerDetectionMock.mockReturnValue({ result: null, measuredFps: null });
  useAutoCaptureMock.mockReturnValue({
    status: 'searching',
    progress: 0,
    capturedFrame: null,
    onFrame: vi.fn(),
  });
  useManualCaptureMock.mockReturnValue({
    capturedFrame: null,
    canCapture: false,
    capture: vi.fn(),
  });
  useDewarpMock.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  loadOpenCvMock.mockReset();
  useCameraStreamMock.mockReset();
  useCornerDetectionMock.mockReset();
  useAutoCaptureMock.mockReset();
  useManualCaptureMock.mockReset();
  useDewarpMock.mockReset();
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
    expect(useCornerDetectionMock).toHaveBeenCalledWith(
      expect.anything(),
      true,
      expect.any(Function),
    );
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

  it('shows stabilizing progress while the auto-capture gate is timing a hold', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useAutoCaptureMock.mockReturnValue({
      status: 'stabilizing',
      progress: 0.42,
      capturedFrame: null,
      onFrame: vi.fn(),
    });

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.getByText('Hold steady… 42%')).toBeInTheDocument();
    });
    expect(screen.queryByText('Captured')).not.toBeInTheDocument();
  });

  it('shows a captured indicator once the auto-capture gate fires', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useAutoCaptureMock.mockReturnValue({
      status: 'captured',
      progress: 1,
      capturedFrame: FAKE_CAPTURED_FRAME,
      onFrame: vi.fn(),
    });

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.getByText('Captured')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Hold steady/)).not.toBeInTheDocument();
  });

  it('keeps showing the captured indicator through cooldown, not just the instant of capture', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useAutoCaptureMock.mockReturnValue({
      status: 'cooldown',
      progress: 1,
      capturedFrame: FAKE_CAPTURED_FRAME,
      onFrame: vi.fn(),
    });

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.getByText('Captured')).toBeInTheDocument();
    });
  });

  it('passes the captured frame into useDewarp', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useAutoCaptureMock.mockReturnValue({
      status: 'captured',
      progress: 1,
      capturedFrame: FAKE_CAPTURED_FRAME,
      onFrame: vi.fn(),
    });

    render(<ScanClient />);

    await waitFor(() => {
      expect(useDewarpMock).toHaveBeenCalledWith(FAKE_CAPTURED_FRAME);
    });
  });

  it('shows a dewarped preview once one is available', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useAutoCaptureMock.mockReturnValue({
      status: 'captured',
      progress: 1,
      capturedFrame: FAKE_CAPTURED_FRAME,
      onFrame: vi.fn(),
    });
    useDewarpMock.mockReturnValue({
      imageData: FAKE_CAPTURED_FRAME.imageData,
      width: 2,
      height: 2,
    });

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.getByText('Dewarped')).toBeInTheDocument();
    });
  });

  it('does not show a dewarped preview before one is available, even while captured', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useAutoCaptureMock.mockReturnValue({
      status: 'captured',
      progress: 1,
      capturedFrame: FAKE_CAPTURED_FRAME,
      onFrame: vi.fn(),
    });
    useDewarpMock.mockReturnValue(null);

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.getByText('Captured')).toBeInTheDocument();
    });
    expect(screen.queryByText('Dewarped')).not.toBeInTheDocument();
  });

  it('shows neither stabilizing progress nor a captured indicator while still searching', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useAutoCaptureMock.mockReturnValue({
      status: 'searching',
      progress: 0,
      capturedFrame: null,
      onFrame: vi.fn(),
    });

    render(<ScanClient />);

    await waitFor(() => {
      expect(document.querySelector('video')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Hold steady/)).not.toBeInTheDocument();
    expect(screen.queryByText('Captured')).not.toBeInTheDocument();
  });

  it('always shows the manual "Take Photo" button once ready, regardless of auto-capture status', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useAutoCaptureMock.mockReturnValue({
      status: 'stabilizing',
      progress: 0.5,
      capturedFrame: null,
      onFrame: vi.fn(),
    });

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /take photo/i })).toBeInTheDocument();
    });
  });

  it('disables the manual capture button when corners are not fully detected', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useManualCaptureMock.mockReturnValue({
      capturedFrame: null,
      canCapture: false,
      capture: vi.fn(),
    });

    render(<ScanClient />);

    const button = await screen.findByRole('button', { name: /take photo/i });
    expect(button).toBeDisabled();
  });

  it('enables the manual capture button once corners are fully detected, and clicking it calls capture()', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    const capture = vi.fn();
    useManualCaptureMock.mockReturnValue({ capturedFrame: null, canCapture: true, capture });

    render(<ScanClient />);

    const button = await screen.findByRole('button', { name: /take photo/i });
    expect(button).not.toBeDisabled();

    button.click();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('passes the latest detection result into useManualCapture', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    const detectionResult = { complete: false, found: {} };
    useCornerDetectionMock.mockReturnValue({ result: detectionResult, measuredFps: null });

    render(<ScanClient />);

    await waitFor(() => {
      expect(useManualCaptureMock).toHaveBeenCalledWith(expect.anything(), detectionResult);
    });
  });

  it('shows a manual capture indicator once one is available, independent of auto-capture', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });
    useManualCaptureMock.mockReturnValue({
      capturedFrame: FAKE_CAPTURED_FRAME,
      canCapture: true,
      capture: vi.fn(),
    });

    render(<ScanClient />);

    await waitFor(() => {
      expect(screen.getByText('Manual capture')).toBeInTheDocument();
    });
    // Auto-capture's own "Captured" badge is a distinct indicator and
    // should not appear just because a manual capture happened.
    expect(screen.queryByText('Captured')).not.toBeInTheDocument();
  });

  it('does not show a manual capture indicator before one is available', async () => {
    loadOpenCvMock.mockReturnValue(OPENCV_READY);
    mockCamera({ status: 'live' });

    render(<ScanClient />);

    await waitFor(() => {
      expect(document.querySelector('video')).toBeInTheDocument();
    });
    expect(screen.queryByText('Manual capture')).not.toBeInTheDocument();
  });
});

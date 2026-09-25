import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { useCameraStream } from './use-camera-stream';
import { CameraError } from '@/lib/scanning/camera';

const { getCameraStreamMock, stopCameraStreamMock } = vi.hoisted(() => ({
  getCameraStreamMock: vi.fn(),
  stopCameraStreamMock: vi.fn(),
}));

vi.mock('@/lib/scanning/camera', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/scanning/camera')>('@/lib/scanning/camera');
  return {
    ...actual,
    getCameraStream: getCameraStreamMock,
    stopCameraStream: stopCameraStreamMock,
  };
});

function fakeStream(): MediaStream {
  return { getTracks: () => [] } as unknown as MediaStream;
}

function fakeVideoRef(): RefObject<HTMLVideoElement | null> {
  return { current: { srcObject: null } as unknown as HTMLVideoElement };
}

afterEach(() => {
  getCameraStreamMock.mockReset();
  stopCameraStreamMock.mockReset();
});

describe('useCameraStream', () => {
  it('starts in requesting state, then transitions to live and attaches the stream to the video ref', async () => {
    const stream = fakeStream();
    getCameraStreamMock.mockResolvedValue(stream);
    const videoRef = fakeVideoRef();

    const { result } = renderHook(() => useCameraStream(videoRef));

    expect(result.current.state).toEqual({ status: 'requesting' });

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'live' });
    });
    expect(videoRef.current?.srcObject).toBe(stream);
  });

  it('attaches the stream even when the <video> element mounts only after the stream has already resolved', async () => {
    // Regression test: a real <video ref={videoRef}> only mounts once
    // `state.status === 'live'`, which is one render *after* the stream
    // itself resolves — so `videoRef.current` is genuinely null at the
    // moment the stream resolves on every real run, not occasionally.
    // A ref pre-populated from the start (as in the test above) can't
    // catch a regression here; this test starts with a null ref and only
    // populates it after `live` is reached, mirroring real mount timing.
    // Found via real-browser verification (Playwright), not this suite.
    const stream = fakeStream();
    getCameraStreamMock.mockResolvedValue(stream);
    const videoRef: RefObject<HTMLVideoElement | null> = { current: null };

    const { result, rerender } = renderHook(() => useCameraStream(videoRef));

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'live' });
    });
    expect(videoRef.current).toBeNull();

    // Simulate the <video> element mounting now that `state` is 'live',
    // then a re-render — exactly what the real component does.
    videoRef.current = { srcObject: null } as unknown as HTMLVideoElement;
    rerender();

    expect(videoRef.current.srcObject).toBe(stream);
  });

  it('transitions to an error state with the classified reason on failure', async () => {
    getCameraStreamMock.mockRejectedValue(new CameraError('permission-denied', 'denied'));
    const videoRef = fakeVideoRef();

    const { result } = renderHook(() => useCameraStream(videoRef));

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'error', reason: 'permission-denied' });
    });
  });

  it('stops the stream on unmount', async () => {
    const stream = fakeStream();
    getCameraStreamMock.mockResolvedValue(stream);
    const videoRef = fakeVideoRef();

    const { result, unmount } = renderHook(() => useCameraStream(videoRef));
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'live' });
    });

    unmount();

    expect(stopCameraStreamMock).toHaveBeenCalledWith(stream);
  });

  it('stops a stream that resolves after unmount, instead of attaching it', async () => {
    let resolveStream!: (stream: MediaStream) => void;
    getCameraStreamMock.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        resolveStream = resolve;
      }),
    );

    const { unmount } = renderHook(() => useCameraStream(fakeVideoRef()));
    unmount();

    const stream = fakeStream();
    await act(async () => {
      resolveStream(stream);
    });

    expect(stopCameraStreamMock).toHaveBeenCalledWith(stream);
  });

  it('retry() re-requests the camera and returns to requesting immediately', async () => {
    getCameraStreamMock.mockRejectedValueOnce(new CameraError('camera-in-use', 'busy'));
    const stream = fakeStream();
    getCameraStreamMock.mockResolvedValueOnce(stream);
    const videoRef = fakeVideoRef();

    const { result } = renderHook(() => useCameraStream(videoRef));
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'error', reason: 'camera-in-use' });
    });

    act(() => {
      result.current.retry();
    });

    expect(result.current.state).toEqual({ status: 'requesting' });

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'live' });
    });
    expect(getCameraStreamMock).toHaveBeenCalledTimes(2);
  });
});

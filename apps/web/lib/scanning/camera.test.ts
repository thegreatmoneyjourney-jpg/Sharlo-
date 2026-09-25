import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraError, getCameraStream, stopCameraStream } from './camera';

function mockGetUserMedia(impl: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(impl) },
  });
}

function fakeStream(trackCount = 1): MediaStream {
  const tracks = Array.from({ length: trackCount }, () => ({ stop: vi.fn() }));
  return { getTracks: () => tracks } as unknown as MediaStream;
}

describe('getCameraStream', () => {
  const originalIsSecureContext = window.isSecureContext;

  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: originalIsSecureContext,
    });
    vi.restoreAllMocks();
  });

  it('resolves with the stream on success, requesting the rear camera', async () => {
    const stream = fakeStream();
    mockGetUserMedia(async () => stream);

    const result = await getCameraStream();

    expect(result).toBe(stream);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
      }),
    );
  });

  it('throws insecure-context before ever calling getUserMedia, when not in a secure context', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    await expect(getCameraStream()).rejects.toMatchObject({ reason: 'insecure-context' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('throws unsupported when the browser has no mediaDevices API', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });

    await expect(getCameraStream()).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'no-camera-found'],
    ['OverconstrainedError', 'no-camera-found'],
    ['NotReadableError', 'camera-in-use'],
    ['AbortError', 'unknown'],
  ] as const)('classifies DOMException %s as reason %s', async (domName, reason) => {
    mockGetUserMedia(async () => {
      throw new DOMException('simulated', domName);
    });

    const rejection = getCameraStream();
    await expect(rejection).rejects.toBeInstanceOf(CameraError);
    await expect(rejection).rejects.toMatchObject({ reason });
  });

  it('classifies a non-DOMException failure as unknown rather than throwing raw', async () => {
    mockGetUserMedia(async () => {
      throw new Error('something else entirely');
    });

    await expect(getCameraStream()).rejects.toMatchObject({ reason: 'unknown' });
  });
});

describe('stopCameraStream', () => {
  it('stops every track on the stream', () => {
    const stream = fakeStream(2);

    stopCameraStream(stream);

    for (const track of stream.getTracks()) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });
});

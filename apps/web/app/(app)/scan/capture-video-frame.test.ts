import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureVideoFrame } from './capture-video-frame';
import type { CornerName, DetectedCorner, Point } from '@/lib/scanning/corner-markers';

function corner(name: CornerName, center: Point): DetectedCorner {
  return { name, center, markerCorners: [center, center, center, center] };
}

const CORNERS: Record<CornerName, DetectedCorner> = {
  topLeft: corner('topLeft', { x: 0, y: 0 }),
  topRight: corner('topRight', { x: 100, y: 0 }),
  bottomRight: corner('bottomRight', { x: 100, y: 100 }),
  bottomLeft: corner('bottomLeft', { x: 0, y: 100 }),
};

function fakeVideo(videoWidth: number, videoHeight = 80): HTMLVideoElement {
  return { videoWidth, videoHeight } as unknown as HTMLVideoElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('captureVideoFrame', () => {
  it('returns null when the video has no decoded frame yet (videoWidth 0)', () => {
    const result = captureVideoFrame(fakeVideo(0), CORNERS, 1000);
    expect(result).toBeNull();
  });

  it('returns null when a 2D canvas context is unavailable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const result = captureVideoFrame(fakeVideo(100), CORNERS, 1000);
    expect(result).toBeNull();
  });

  it('draws the video frame and returns it with the given corners and timestamp', () => {
    const drawImage = vi.fn();
    const fakeImageData = { width: 100, height: 80 } as unknown as ImageData;
    const getImageData = vi.fn(() => fakeImageData);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      getImageData,
    } as unknown as CanvasRenderingContext2D);

    const video = fakeVideo(100, 80);
    const result = captureVideoFrame(video, CORNERS, 1234);

    expect(drawImage).toHaveBeenCalledWith(video, 0, 0);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 100, 80);
    expect(result).toEqual({ imageData: fakeImageData, corners: CORNERS, capturedAt: 1234 });
  });
});

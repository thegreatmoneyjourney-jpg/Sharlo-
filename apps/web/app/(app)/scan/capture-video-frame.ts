import type { CornerName, DetectedCorner } from '@/lib/scanning/corner-markers';

export interface CapturedFrame {
  imageData: ImageData;
  corners: Record<CornerName, DetectedCorner>;
  capturedAt: number;
}

/**
 * Grabs the current frame off a live `<video>` element via an offscreen
 * canvas. Shared by the auto-capture (M1-004) and manual-capture
 * (M1-008) paths so there's exactly one place that does this, not two
 * copies that could drift — both ultimately produce the same
 * `CapturedFrame` shape, so everything downstream (M1-005's dewarp
 * onward) works identically regardless of which path triggered it.
 */
export function captureVideoFrame(
  video: HTMLVideoElement,
  corners: Record<CornerName, DetectedCorner>,
  now: number,
): CapturedFrame | null {
  if (video.videoWidth === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0);
  return {
    imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
    corners,
    capturedAt: now,
  };
}

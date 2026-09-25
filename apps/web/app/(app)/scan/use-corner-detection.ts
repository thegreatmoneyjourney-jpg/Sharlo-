import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';
import { CornerMarkerDetector } from '@/lib/scanning/corner-markers';
import type { ArucoCv, CornerDetectionResult } from '@/lib/scanning/corner-markers';

/**
 * Target ≥10fps per NFR-PERF-03; 12 leaves a little headroom so frame-
 * to-frame timing jitter doesn't dip the *sustained* rate below the
 * floor. Runs the detection loop against a live <video> element once
 * OpenCV is loaded and `active` is true — pauses (no frames processed,
 * no CPU spent) whenever `active` is false, e.g. while the camera
 * itself isn't live yet.
 */
const TARGET_FPS = 12;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

export interface CornerDetectionState {
  result: CornerDetectionResult | null;
  /** Measured over trailing ~1s windows — real throughput in this environment, not a device-independent guarantee (see docs/reports/SHARLO-M1-003.md). */
  measuredFps: number | null;
}

export function useCornerDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean,
): CornerDetectionState {
  const [result, setResult] = useState<CornerDetectionResult | null>(null);
  const [measuredFps, setMeasuredFps] = useState<number | null>(null);

  useEffect(() => {
    // No setState here when inactive — internal state is simply masked
    // out below (`active ? result : null`) rather than cleared via an
    // effect-body setState call, which would cascade an extra render.
    if (!active) return;

    let cancelled = false;
    let rafId = 0;

    loadOpenCv().then(({ cv }) => {
      if (cancelled) return;

      const detector = new CornerMarkerDetector(cv as unknown as ArucoCv);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      let lastFrameTime = 0;
      let frameCount = 0;
      let fpsWindowStart = performance.now();

      const loop = (now: number) => {
        if (cancelled) return;
        rafId = requestAnimationFrame(loop);

        if (now - lastFrameTime < FRAME_INTERVAL_MS) return;
        lastFrameTime = now;

        const video = videoRef.current;
        // readyState >= 2 (HAVE_CURRENT_DATA): the video actually has a
        // decoded frame to read, not just metadata.
        if (!video || video.readyState < 2 || video.videoWidth === 0) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const mat = (cv as unknown as ArucoCv).matFromImageData(imageData);
        try {
          setResult(detector.detect(mat));
        } finally {
          mat.delete();
        }

        frameCount++;
        const elapsed = now - fpsWindowStart;
        if (elapsed >= 1000) {
          setMeasuredFps((frameCount * 1000) / elapsed);
          frameCount = 0;
          fpsWindowStart = now;
        }
      };

      rafId = requestAnimationFrame(loop);
    });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [active, videoRef]);

  return {
    result: active ? result : null,
    measuredFps: active ? measuredFps : null,
  };
}

import { useCallback, useState } from 'react';
import type { RefObject } from 'react';
import { playCaptureFeedback } from '@/lib/scanning/capture-feedback';
import type { CornerDetectionResult } from '@/lib/scanning/corner-markers';
import { captureVideoFrame } from './capture-video-frame';
import type { CapturedFrame } from './capture-video-frame';

export interface UseManualCaptureResult {
  capturedFrame: CapturedFrame | null;
  /** True only once all 4 corners are detected — there's nothing valid to hand to M1-005's dewarp otherwise. */
  canCapture: boolean;
  capture: () => void;
}

/**
 * FR-SCAN-04: a manual capture path, entirely independent of
 * StabilityGate (M1-004) — an explicit tap is always honored regardless
 * of the gate's own state (searching/stabilizing/cooldown), for exactly
 * the situations where auto-capture's *timing* isn't reliable (iOS
 * Safari, per this task's own done-when criterion — see
 * docs/reports/SHARLO-M1-008.md for why that specific platform couldn't
 * be tested in this sandbox). This removes the *stability wait*, not
 * the detection requirement itself: a capture still needs all 4 corners
 * found at the moment of the tap, the same baseline requirement
 * dewarp (M1-005) has regardless of how the frame was captured — so
 * `canCapture` reflects that, for the caller to use as a disabled
 * state on the button rather than silently producing a capture with
 * nothing usable in it.
 */
export function useManualCapture(
  videoRef: RefObject<HTMLVideoElement | null>,
  detectionResult: CornerDetectionResult | null,
): UseManualCaptureResult {
  const [capturedFrame, setCapturedFrame] = useState<CapturedFrame | null>(null);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !detectionResult?.complete) return;

    const frame = captureVideoFrame(video, detectionResult.corners, performance.now());
    if (!frame) return;

    playCaptureFeedback();
    setCapturedFrame(frame);
  }, [videoRef, detectionResult]);

  return {
    capturedFrame,
    canCapture: detectionResult?.complete ?? false,
    capture,
  };
}

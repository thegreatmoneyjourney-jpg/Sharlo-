import { useCallback, useState } from 'react';
import type { RefObject } from 'react';
import { StabilityGate } from '@/lib/scanning/stability-gate';
import type { StabilityGateConfig, StabilityGateStatus } from '@/lib/scanning/stability-gate';
import type {
  CornerDetectionResult,
  CornerName,
  DetectedCorner,
} from '@/lib/scanning/corner-markers';

export interface CapturedFrame {
  imageData: ImageData;
  corners: Record<CornerName, DetectedCorner>;
  capturedAt: number;
}

export interface AutoCaptureState {
  status: StabilityGateStatus['status'];
  /** 0..1 while stabilizing; 1 once captured; retains its prior value through cooldown. */
  progress: number;
  capturedFrame: CapturedFrame | null;
}

export interface UseAutoCaptureResult extends AutoCaptureState {
  onFrame: (result: CornerDetectionResult, now: number) => void;
}

function progressFor(status: StabilityGateStatus, prevProgress: number): number {
  switch (status.status) {
    case 'searching':
      return 0;
    case 'stabilizing':
      return status.elapsedMs / status.requiredMs;
    case 'captured':
      return 1;
    case 'cooldown':
      return prevProgress;
    default:
      return prevProgress;
  }
}

/**
 * FR-SCAN-02 auto-capture trigger. `onFrame` is meant to be passed
 * straight into useCornerDetection's own `onFrame` parameter so this
 * hook's state updates happen inside that hook's existing
 * requestAnimationFrame loop, not from a second effect watching a
 * `result` prop — see the comment in use-corner-detection.ts for why
 * that distinction matters for this repo's react-hooks/set-state-in-effect
 * rule.
 */
export function useAutoCapture(
  videoRef: RefObject<HTMLVideoElement | null>,
  config?: Partial<StabilityGateConfig>,
): UseAutoCaptureResult {
  // Lazy initializer runs exactly once, on the first render — config
  // changing on later renders deliberately doesn't reconstruct the gate
  // mid-session.
  const [gate] = useState(() => new StabilityGate(config));

  const [state, setState] = useState<AutoCaptureState>({
    status: 'searching',
    progress: 0,
    capturedFrame: null,
  });

  const onFrame = useCallback(
    (result: CornerDetectionResult, now: number) => {
      const gateStatus = gate.update(result, now);

      if (gateStatus.status === 'captured') {
        const video = videoRef.current;
        if (video && video.videoWidth > 0) {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0);
            setState({
              status: 'captured',
              progress: 1,
              capturedFrame: {
                imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
                corners: gateStatus.corners,
                capturedAt: now,
              },
            });
            return;
          }
        }
      }

      setState((prev) => ({
        status: gateStatus.status,
        progress: progressFor(gateStatus, prev.progress),
        capturedFrame: gateStatus.status === 'cooldown' ? prev.capturedFrame : null,
      }));
    },
    [gate, videoRef],
  );

  return { ...state, onFrame };
}

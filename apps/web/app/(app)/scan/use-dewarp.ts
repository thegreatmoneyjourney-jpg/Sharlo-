import { useEffect, useState } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';
import { dewarpFrame } from '@/lib/scanning/perspective-transform';
import type { PerspectiveCv } from '@/lib/scanning/perspective-transform';
import type { CapturedFrame } from './use-auto-capture';

export interface DewarpedPreview {
  imageData: ImageData;
  width: number;
  height: number;
}

/**
 * Runs the M1-005 perspective transform against the most recently
 * auto-captured frame (M1-004). Unlike use-corner-detection.ts's hot,
 * ~12fps loop, this reacts to one discrete event — a new capture — so a
 * plain effect keyed on `capturedFrame` is the right tool, not a repeat
 * of the react-hooks/set-state-in-effect issue hit there: this effect
 * only re-runs when a genuinely new capture arrives, not many times a
 * second, and the "nothing to do" branch below never calls setState
 * synchronously (masked at return instead), matching the established
 * fix for that same class of problem.
 */
export function useDewarp(capturedFrame: CapturedFrame | null): DewarpedPreview | null {
  const [preview, setPreview] = useState<DewarpedPreview | null>(null);

  useEffect(() => {
    if (!capturedFrame) return;

    let cancelled = false;

    loadOpenCv().then(({ cv }) => {
      if (cancelled) return;
      const perspectiveCv = cv as unknown as PerspectiveCv;

      const frameMat = perspectiveCv.matFromImageData(capturedFrame.imageData);
      try {
        const { mat, width, height } = dewarpFrame(perspectiveCv, frameMat, capturedFrame.corners);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          perspectiveCv.imshow(canvas, mat);
          const ctx = canvas.getContext('2d');
          const imageData = ctx?.getImageData(0, 0, width, height);
          if (imageData && !cancelled) {
            setPreview({ imageData, width, height });
          }
        } finally {
          mat.delete();
        }
      } finally {
        frameMat.delete();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [capturedFrame]);

  return capturedFrame ? preview : null;
}

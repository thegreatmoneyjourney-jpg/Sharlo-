'use client';

import { useEffect, useState } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';
import { DEFAULT_PADDING_RATIO, dewarpFrame } from '@/lib/scanning/perspective-transform';
import type { PerspectiveCv } from '@/lib/scanning/perspective-transform';
import { readAnswerSheet } from '@/lib/scanning/read-answer-sheet';
import type { ReadAnswerSheetResult } from '@/lib/scanning/read-answer-sheet';
import { mapTemplateGeometryToFrame } from '@/lib/templates/map-geometry-to-frame';
import type { TemplateGeometry } from '@/lib/templates/geometry';
import type { CapturedFrame } from '../../scan/capture-video-frame';

/**
 * Runs the M2-004 read pipeline (dewarp -> map geometry to frame ->
 * sample/classify every bubble) against a newly captured frame, for a
 * known `geometry` — the "template geometry reader"
 * `bubble-fill.ts`/`roll-number.ts` deferred to this task. Same
 * `useEffect`-keyed-on-a-new-capture shape as `use-dewarp.ts` (a
 * discrete event, not a hot per-frame loop), extended one step further:
 * where `use-dewarp.ts` stops at a displayable dewarped preview, this
 * also runs the actual bubble-reading pass, since both `capture-key`
 * and `scan-students` steps need the same classified-questions output,
 * just interpreted differently by the caller (recorded as the key, or
 * scored against it).
 */
export function useSheetReader(
  capturedFrame: CapturedFrame | null,
  geometry: TemplateGeometry | null,
): ReadAnswerSheetResult | null {
  const [result, setResult] = useState<ReadAnswerSheetResult | null>(null);

  useEffect(() => {
    if (!capturedFrame || !geometry) return;
    let cancelled = false;

    loadOpenCv().then(({ cv }) => {
      if (cancelled) return;
      const perspectiveCv = cv as unknown as PerspectiveCv;

      const frameMat = perspectiveCv.matFromImageData(capturedFrame.imageData);
      try {
        const dewarped = dewarpFrame(perspectiveCv, frameMat, capturedFrame.corners);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = dewarped.width;
          canvas.height = dewarped.height;
          perspectiveCv.imshow(canvas, dewarped.mat);
          const ctx = canvas.getContext('2d');
          const imageData = ctx?.getImageData(0, 0, dewarped.width, dewarped.height);
          if (imageData && !cancelled) {
            const mappedGeometry = mapTemplateGeometryToFrame(
              geometry,
              { width: dewarped.width, height: dewarped.height },
              DEFAULT_PADDING_RATIO,
            );
            setResult(readAnswerSheet(imageData, mappedGeometry));
          }
        } finally {
          dewarped.mat.delete();
        }
      } finally {
        frameMat.delete();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [capturedFrame, geometry]);

  return capturedFrame ? result : null;
}

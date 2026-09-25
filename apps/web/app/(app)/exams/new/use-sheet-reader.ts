'use client';

import { useEffect, useState } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';
import { DEFAULT_PADDING_RATIO, dewarpFrame } from '@/lib/scanning/perspective-transform';
import type { PerspectiveCv } from '@/lib/scanning/perspective-transform';
import { readAnswerSheet } from '@/lib/scanning/read-answer-sheet';
import type { ReadAnswerSheetResult } from '@/lib/scanning/read-answer-sheet';
import { readRollNumber } from '@/lib/scanning/roll-number';
import type { RollNumberReadResult } from '@/lib/scanning/roll-number';
import { buildReviewItemSpecs } from '@/lib/scanning/review-queue';
import type { CropRect } from '@/lib/scanning/review-queue';
import { mapTemplateGeometryToFrame } from '@/lib/templates/map-geometry-to-frame';
import type { TemplateGeometry } from '@/lib/templates/geometry';
import type { CapturedFrame } from '../../scan/capture-video-frame';

export type ReviewCropItem =
  | { kind: 'question'; questionNumber: number; cropDataUrl: string }
  | { kind: 'roll-number'; cropDataUrl: string };

export interface SheetReadOutcome {
  result: ReadAnswerSheetResult;
  rollRead: RollNumberReadResult;
  /** One entry per flagged question plus (if unreadable) one for the roll-number block — M2-006's Review Queue (FR-REVIEW-01, FR-DETECT-04). Empty whenever nothing on this sheet needs review. */
  reviewCrops: ReviewCropItem[];
}

function cropToDataUrl(source: HTMLCanvasElement, rect: CropRect): string {
  const crop = document.createElement('canvas');
  crop.width = Math.max(1, Math.round(rect.width));
  crop.height = Math.max(1, Math.round(rect.height));
  const ctx = crop.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(
    source,
    rect.left,
    rect.top,
    rect.width,
    rect.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  return crop.toDataURL('image/png');
}

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
 *
 * Also generates M2-006's Review Queue crops here, not in a second pass:
 * the dewarped canvas this effect builds to extract `ImageData` for
 * reading is the exact same pixel source a crop needs, and it only
 * exists for the lifetime of this effect — computing crops anywhere
 * else would mean dewarping the frame a second time just to get a
 * `Canvas` back.
 */
export function useSheetReader(
  capturedFrame: CapturedFrame | null,
  geometry: TemplateGeometry | null,
): SheetReadOutcome | null {
  const [outcome, setOutcome] = useState<SheetReadOutcome | null>(null);

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
            const frameSize = { width: dewarped.width, height: dewarped.height };
            const mappedGeometry = mapTemplateGeometryToFrame(
              geometry,
              frameSize,
              DEFAULT_PADDING_RATIO,
            );
            const result = readAnswerSheet(imageData, mappedGeometry);
            const rollRead = readRollNumber(result.rollNumberColumns);
            const specs = buildReviewItemSpecs(result, mappedGeometry, rollRead, frameSize);
            const reviewCrops: ReviewCropItem[] = specs.map((spec) =>
              spec.kind === 'question'
                ? {
                    kind: 'question',
                    questionNumber: spec.questionNumber,
                    cropDataUrl: cropToDataUrl(canvas, spec.cropRect),
                  }
                : { kind: 'roll-number', cropDataUrl: cropToDataUrl(canvas, spec.cropRect) },
            );
            setOutcome({ result, rollRead, reviewCrops });
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

  return capturedFrame ? outcome : null;
}

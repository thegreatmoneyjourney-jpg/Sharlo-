/**
 * Shared core of the M2-004 read pipeline (dewarp -> map geometry to
 * frame -> sample/classify every bubble -> M2-006 review crops), used by
 * both `app/(app)/exams/new/use-sheet-reader.ts` (live capture, corners
 * already known from the continuous per-frame detection loop) and
 * M2-009's batch import (an uploaded image/PDF page has no pre-known
 * corners, so `detectAndReadSheet` runs the exact same
 * `CornerMarkerDetector` the live loop uses before handing off to the
 * same read logic). Neither caller duplicates this logic — M2-009's own
 * done-when wording, "the same review-queue/scoring path as live scans,"
 * means literally the same function, not a parallel implementation that
 * could quietly drift from it.
 *
 * `cv` must already be loaded (`lib/scanning/opencv-loader.ts`'s
 * `loadOpenCv()`) — every function here is a plain, non-hook function
 * with no loading logic of its own; that's each caller's job.
 */

import { CornerMarkerDetector } from './corner-markers';
import type { ArucoCv, CornerName, DetectedCorner } from './corner-markers';
import { DEFAULT_PADDING_RATIO, dewarpFrame } from './perspective-transform';
import type { PerspectiveCv } from './perspective-transform';
import { readAnswerSheet } from './read-answer-sheet';
import type { ReadAnswerSheetResult } from './read-answer-sheet';
import { readRollNumber } from './roll-number';
import type { RollNumberReadResult } from './roll-number';
import { buildReviewItemSpecs } from './review-queue';
import type { CropRect } from './review-queue';
import { mapTemplateGeometryToFrame } from '../templates/map-geometry-to-frame';
import type { TemplateGeometry } from '../templates/geometry';

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
 * `corners` must already be a complete detection (all 4 markers) against
 * `imageData` — this function does no detection of its own, matching
 * `dewarpFrame`'s own precondition. Returns `null` only in the
 * practically-unreachable case where the dewarped canvas's own 2D
 * context is unavailable (the same defensive-but-unreachable class
 * `use-sheet-reader.ts`'s original inline version already had).
 */
export function readSheetFromCorners(
  cv: unknown,
  imageData: ImageData,
  corners: Record<CornerName, DetectedCorner>,
  geometry: TemplateGeometry,
): SheetReadOutcome | null {
  const perspectiveCv = cv as PerspectiveCv;
  const frameMat = perspectiveCv.matFromImageData(imageData);
  try {
    const dewarped = dewarpFrame(perspectiveCv, frameMat, corners);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = dewarped.width;
      canvas.height = dewarped.height;
      perspectiveCv.imshow(canvas, dewarped.mat);
      const ctx = canvas.getContext('2d');
      const dewarpedImageData = ctx?.getImageData(0, 0, dewarped.width, dewarped.height);
      if (!dewarpedImageData) return null;

      const frameSize = { width: dewarped.width, height: dewarped.height };
      const mappedGeometry = mapTemplateGeometryToFrame(geometry, frameSize, DEFAULT_PADDING_RATIO);
      const result = readAnswerSheet(dewarpedImageData, mappedGeometry);
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
      return { result, rollRead, reviewCrops };
    } finally {
      dewarped.mat.delete();
    }
  } finally {
    frameMat.delete();
  }
}

export type DetectAndReadResult =
  { status: 'no-markers-detected' } | { status: 'read'; outcome: SheetReadOutcome };

/**
 * For a static image with no pre-known corners (M2-009 batch import,
 * where each uploaded image/PDF page arrives cold — unlike live capture,
 * there's no preceding continuous detection loop that already found
 * them). Runs the exact same `CornerMarkerDetector`
 * `use-corner-detection.ts`'s live loop uses, then hands off to
 * `readSheetFromCorners`. A scanner-produced image is typically flatter/
 * better-aligned than a handheld camera frame, so this is if anything an
 * easier case for the same detector, not a different one.
 */
export function detectAndReadSheet(
  cv: unknown,
  imageData: ImageData,
  geometry: TemplateGeometry,
): DetectAndReadResult {
  const arucoCv = cv as ArucoCv;
  const mat = arucoCv.matFromImageData(imageData);
  const detector = new CornerMarkerDetector(arucoCv);
  let detection;
  try {
    detection = detector.detect(mat);
  } finally {
    mat.delete();
  }
  if (!detection.complete) return { status: 'no-markers-detected' };

  const outcome = readSheetFromCorners(cv, imageData, detection.corners, geometry);
  if (!outcome) return { status: 'no-markers-detected' };
  return { status: 'read', outcome };
}

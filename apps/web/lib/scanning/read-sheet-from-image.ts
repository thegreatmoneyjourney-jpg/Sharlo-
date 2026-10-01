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
import { resolveRollNumberAgainstRoster } from '../roster/roster';
import type { RosterMatchOutcome } from '../roster/roster';

export type ReviewCropItem =
  | { kind: 'question'; questionNumber: number; cropDataUrl: string }
  | { kind: 'roll-number'; cropDataUrl: string };

export interface SheetReadOutcome {
  result: ReadAnswerSheetResult;
  rollRead: RollNumberReadResult;
  /** `M3-007` (`FR-ROSTER-02`) — the outcome of checking `rollRead` against `rosterLookup` (see `readSheetFromCorners`'s param below). Always `{ needsReview: true, reason: 'unread' }` when `rosterLookup` is `null`/omitted and `rollRead` is unreadable, and always `{ needsReview: false, studentName: null }` when it's `null` and `rollRead` read cleanly — "no roster selected" behaves exactly as it did before this field existed. */
  rollNumberMatch: RosterMatchOutcome;
  /** One entry per flagged question plus (if the roll number needs review) one for the roll-number block — M2-006's Review Queue (FR-REVIEW-01, FR-DETECT-04). Empty whenever nothing on this sheet needs review. */
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
 *
 * `rosterLookup` (`M3-007`, `FR-ROSTER-02`) is `null`/omitted when the
 * teacher hasn't selected a class list for this exam — rostering is
 * opt-in, so that's the same "accept whatever roll number was read, no
 * name attached" behavior this function always had. When provided, a
 * read roll number is checked against it (`resolveRollNumberAgainstRoster`)
 * and either resolves to a matched student name or routes to the Review
 * Queue with a reason, exactly like an unreadable roll number already did.
 */
export function readSheetFromCorners(
  cv: unknown,
  imageData: ImageData,
  corners: Record<CornerName, DetectedCorner>,
  geometry: TemplateGeometry,
  rosterLookup: ReadonlyMap<string, string> | null = null,
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
      const rollNumberMatch = resolveRollNumberAgainstRoster(rollRead, rosterLookup);
      const specs = buildReviewItemSpecs(
        result,
        mappedGeometry,
        rollNumberMatch.needsReview ? { reason: rollNumberMatch.reason } : null,
        frameSize,
      );
      const reviewCrops: ReviewCropItem[] = specs.map((spec) =>
        spec.kind === 'question'
          ? {
              kind: 'question',
              questionNumber: spec.questionNumber,
              cropDataUrl: cropToDataUrl(canvas, spec.cropRect),
            }
          : { kind: 'roll-number', cropDataUrl: cropToDataUrl(canvas, spec.cropRect) },
      );
      return { result, rollRead, rollNumberMatch, reviewCrops };
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
 * `readSheetFromCorners` — `rosterLookup` passes straight through so a
 * batch import against a rostered class gets the identical matching
 * behavior a live scan does.
 */
export function detectAndReadSheet(
  cv: unknown,
  imageData: ImageData,
  geometry: TemplateGeometry,
  rosterLookup: ReadonlyMap<string, string> | null = null,
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

  const outcome = readSheetFromCorners(cv, imageData, detection.corners, geometry, rosterLookup);
  if (!outcome) return { status: 'no-markers-detected' };
  return { status: 'read', outcome };
}

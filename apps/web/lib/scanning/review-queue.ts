/**
 * Review Queue item extraction (FR-REVIEW-01, FR-REVIEW-02, and
 * FR-DETECT-04's "unmatched/unread roll numbers route to Review Queue,
 * never silently dropped" — a `done when` M1-009 stated for itself but
 * couldn't actually build, since no Review Queue UI existed yet; this
 * module is where that forward reference finally closes).
 *
 * Deliberately pure and DOM-free, same scope boundary `bubble-fill.ts`/
 * `map-geometry-to-frame.ts` already draw for themselves: this module
 * decides *which* questions/roll-number need review and *where* on the
 * dewarped frame to crop from (`CropRect`, in dewarped-frame pixels), but
 * never touches a `Canvas` or produces actual image bytes — turning a
 * `CropRect` into a real cropped image is `app/(app)/exams/new/
 * use-sheet-reader.ts`'s job, the same place the dewarped canvas already
 * exists from the read pass itself, so no second dewarp is needed just to
 * generate a crop.
 */

import type { ReadAnswerSheetResult } from './read-answer-sheet';
import type { RollNumberReadResult } from './roll-number';
import type { MappedBubble, MappedTemplateGeometry } from '../templates/map-geometry-to-frame';
import type { NormalizedSize } from './perspective-transform';

export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Extra padding beyond the bubble radius itself, as a multiple of it —
 * generous enough that a crop shows the printed question number and
 * surrounding bubble row a teacher needs to recognize what they're
 * looking at, not just a tight box around the bare option dots.
 */
const CROP_PADDING_RATIO = 1.5;

/** The padded bounding box (clamped to the frame) around a group of mapped bubble centers — one question's options, or every roll-number column's options at once. */
export function boundingCropRect(
  bubbles: readonly MappedBubble[],
  bubbleRadiusPx: number,
  frameSize: NormalizedSize,
): CropRect {
  const pad = bubbleRadiusPx * (1 + CROP_PADDING_RATIO);
  const xs = bubbles.map((b) => b.center.x);
  const ys = bubbles.map((b) => b.center.y);
  const left = Math.max(0, Math.min(...xs) - pad);
  const top = Math.max(0, Math.min(...ys) - pad);
  const right = Math.min(frameSize.width, Math.max(...xs) + pad);
  const bottom = Math.min(frameSize.height, Math.max(...ys) + pad);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export type ReviewItemSpec =
  | { kind: 'question'; questionNumber: number; cropRect: CropRect }
  | { kind: 'roll-number'; cropRect: CropRect };

/**
 * `rollRead` only ever contributes a `'roll-number'` item for
 * `status: 'unreadable'` — not for a read-but-not-on-the-roster case
 * (`matchRollNumber`'s `'unmatched'`), because no roster/class-list data
 * model exists anywhere in this codebase yet (a later milestone's job).
 * Wiring that in is a small, additive follow-up once rostering exists,
 * not a redesign of this function — flagged in `docs/reports/
 * SHARLO-M2-006.md` rather than silently assumed covered.
 */
export function buildReviewItemSpecs(
  readResult: ReadAnswerSheetResult,
  mappedGeometry: MappedTemplateGeometry,
  rollRead: RollNumberReadResult,
  frameSize: NormalizedSize,
): ReviewItemSpec[] {
  const items: ReviewItemSpec[] = [];

  readResult.questions.forEach((result, i) => {
    if (result.outcome !== 'flagged') return;
    const mapped = mappedGeometry.questions[i];
    if (!mapped) return;
    items.push({
      kind: 'question',
      questionNumber: mapped.questionNumber,
      cropRect: boundingCropRect(mapped.options, mappedGeometry.bubbleRadiusPx, frameSize),
    });
  });

  if (rollRead.status === 'unreadable' && mappedGeometry.rollNumberColumns.length > 0) {
    const allRollOptions = mappedGeometry.rollNumberColumns.flatMap((c) => c.options);
    items.push({
      kind: 'roll-number',
      cropRect: boundingCropRect(allRollOptions, mappedGeometry.bubbleRadiusPx, frameSize),
    });
  }

  return items;
}

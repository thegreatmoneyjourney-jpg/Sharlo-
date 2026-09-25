/**
 * Reads a whole dewarped scan frame against a template's bubble
 * positions (FR-EXAM-03, M2-004) — the caller
 * `bubble-fill.ts`/`roll-number.ts` both explicitly deferred to "a real
 * template reader... a later milestone's job (M2-004/M2-005's scan
 * flow)." Combines `map-geometry-to-frame.ts`'s position mapping with
 * `bubble-fill.ts`'s sampling/classification — this module adds no new
 * sampling or classification logic of its own, only the loop that
 * applies them to every question and roll-number column a template
 * defines.
 */

import type { FillConfidenceThresholds, QuestionResult } from './bubble-fill';
import { DEFAULT_FILL_THRESHOLDS, classifyQuestion, sampleBubbleFillRatio } from './bubble-fill';
import type { MappedBubble, MappedTemplateGeometry } from '../templates/map-geometry-to-frame';

export interface ReadAnswerSheetResult {
  /** Same order as `mappedGeometry.questions`. */
  questions: QuestionResult[];
  /** Same order as `mappedGeometry.rollNumberColumns`. */
  rollNumberColumns: QuestionResult[];
}

function readGroup(
  imageData: ImageData,
  options: MappedBubble[],
  radius: number,
  thresholds: FillConfidenceThresholds,
): QuestionResult {
  const ratios = options.map((option) =>
    sampleBubbleFillRatio(imageData, { center: option.center, radius }),
  );
  return classifyQuestion(ratios, thresholds);
}

/**
 * `imageData` must be the dewarped frame `mappedGeometry` was itself
 * computed against (same `dewarpedSize`/`paddingRatio` passed to
 * `mapTemplateGeometryToFrame`) — a mismatch silently samples the wrong
 * pixels, so callers own keeping the two in sync (see
 * `app/(app)/exams/new/use-sheet-reader.ts`, which derives both from
 * the same dewarp call).
 */
export function readAnswerSheet(
  imageData: ImageData,
  mappedGeometry: MappedTemplateGeometry,
  thresholds: FillConfidenceThresholds = DEFAULT_FILL_THRESHOLDS,
): ReadAnswerSheetResult {
  return {
    questions: mappedGeometry.questions.map((q) =>
      readGroup(imageData, q.options, mappedGeometry.bubbleRadiusPx, thresholds),
    ),
    rollNumberColumns: mappedGeometry.rollNumberColumns.map((c) =>
      readGroup(imageData, c.options, mappedGeometry.bubbleRadiusPx, thresholds),
    ),
  };
}

/**
 * Stock bubble-sheet template geometry (M2-001, FR-TPL-01) — the
 * placeholder marker scheme `lib/scanning/corner-markers.ts` flagged as
 * "pending M2-001... a proposal to unblock M1, not a confirmed product
 * decision" is confirmed final here: same 4 IDs, same `DICT_4X4_50`
 * dictionary, no change needed to any M1 detection code.
 *
 * All positions are **absolute PDF points, from the page's top-left**
 * (pdf-lib's own convention is bottom-left-origin `y`-up — this module
 * stays top-left/`y`-down throughout, matching every other coordinate
 * space already used in `lib/scanning`, and only `generate-pdf.ts`
 * converts at the point it actually calls pdf-lib). A future
 * template-geometry *reader* (scan-time: map a detected marker
 * rectangle's corners to real bubble pixel positions in a dewarped
 * frame) uses the exact scale/translate technique already proven in
 * `tests/detection-harness/fixtures.ts`'s `expectedDewarpedPoint` —
 * expressing a bubble's position as a fraction of the marker-bounded
 * rectangle, then applying that fraction to whatever rectangle gets
 * detected at scan time. That reader is out of scope for this task (see
 * docs/reports/SHARLO-M2-001.md's Flags section) — this module only
 * defines *where things are on the page*, in the one coordinate space
 * (absolute page points) that's unambiguous for both PDF generation and
 * for deriving that fraction later, on demand, from whichever two points
 * a reader actually needs it for.
 */

import type { CornerName, Point } from '../scanning/corner-markers';

const PT_PER_MM = 72 / 25.4;
function mm(value: number): number {
  return value * PT_PER_MM;
}

/** A4 portrait — the international default this product targets (Pakistan/Gulf-first, not US-first); see docs/reports/SHARLO-M2-001.md for why US Letter wasn't chosen as the primary size. */
export const PAGE_WIDTH_PT = 595.28;
export const PAGE_HEIGHT_PT = 841.89;

const PAGE_MARGIN = mm(15); // stays inside every common printer's unprintable-margin limit
export const MARKER_SIZE_PT = mm(25); // large enough for reliable phone-camera detection at arm's length
const CONTENT_GAP = mm(8); // clearance between marker footprint and any bubble content

const HEADER_NAME_LINE_HEIGHT = mm(8);
const HEADER_TO_ROLL_GRID_GAP = mm(4);
const ROLL_GRID_BOTTOM_PAD = mm(4);
const HEADER_HEIGHT = mm(60); // name line + roll-number grid, same on every stock variant
const HEADER_TO_ANSWER_GRID_GAP = mm(6);

const ROLL_NUMBER_DIGIT_COLUMNS = 6; // supports roll numbers up to 999,999 — ample for any single class/school
const ROLL_NUMBER_OPTIONS = 10; // digits 0-9
const ROLL_GRID_WIDTH = mm(52);

const ANSWER_OPTIONS_PER_QUESTION = 4; // A/B/C/D — the standard MCQ convention this product targets
const QUESTION_LABEL_WIDTH = mm(8); // fixed width reserved for the printed question number, every column width

/** Shared sampling radius for every bubble on the sheet — answer options and roll-number digits alike, same convention `tests/detection-harness/fixtures.ts` already established (draw ring + sample interior at a slightly smaller radius). */
export const BUBBLE_RADIUS_PT = mm(2);

export interface BubbleGeometry {
  /** 0-based: 0=A,1=B,2=C,3=D for an answer option; 0-9 for a roll-number digit. */
  optionIndex: number;
  /** Absolute PDF points, page top-left origin. */
  center: Point;
}

export interface QuestionGeometry {
  /** 1-based, as printed on the sheet. */
  questionNumber: number;
  options: BubbleGeometry[];
}

export interface RollDigitColumnGeometry {
  /** 0-based, most-significant digit first (left to right). */
  columnIndex: number;
  options: BubbleGeometry[];
}

export const STOCK_TEMPLATE_QUESTION_COUNTS = [20, 50, 100] as const;
export type StockTemplateQuestionCount = (typeof STOCK_TEMPLATE_QUESTION_COUNTS)[number];

export interface TemplateGeometry {
  schemaVersion: 1;
  questionCount: StockTemplateQuestionCount;
  pageWidthPt: number;
  pageHeightPt: number;
  bubbleRadiusPt: number;
  markerSizePt: number;
  /** Marker **centers**, absolute PDF points — matches `CornerName` from `lib/scanning/corner-markers.ts` so a future reader can zip this directly against a `CornerDetectionResult`. */
  markers: Record<CornerName, Point>;
  questions: QuestionGeometry[];
  rollNumberColumns: RollDigitColumnGeometry[];
}

/** Column/row split per stock variant — row count stays constant (20 or 25) across variants so bubble spacing/legibility doesn't degrade as question count grows; only column count increases. */
const GRID_LAYOUT_BY_QUESTION_COUNT: Record<
  StockTemplateQuestionCount,
  { columns: number; rows: number }
> = {
  20: { columns: 1, rows: 20 },
  50: { columns: 2, rows: 25 },
  100: { columns: 4, rows: 25 },
};

function computeMarkerCenters(): Record<CornerName, Point> {
  const half = MARKER_SIZE_PT / 2;
  return {
    topLeft: { x: PAGE_MARGIN + half, y: PAGE_MARGIN + half },
    topRight: { x: PAGE_WIDTH_PT - PAGE_MARGIN - half, y: PAGE_MARGIN + half },
    bottomRight: {
      x: PAGE_WIDTH_PT - PAGE_MARGIN - half,
      y: PAGE_HEIGHT_PT - PAGE_MARGIN - half,
    },
    bottomLeft: { x: PAGE_MARGIN + half, y: PAGE_HEIGHT_PT - PAGE_MARGIN - half },
  };
}

function computeRollNumberColumns(
  contentRight: number,
  contentTop: number,
): RollDigitColumnGeometry[] {
  const gridTop = contentTop + HEADER_NAME_LINE_HEIGHT + HEADER_TO_ROLL_GRID_GAP;
  const gridBottom = contentTop + HEADER_HEIGHT - ROLL_GRID_BOTTOM_PAD;
  const gridHeight = gridBottom - gridTop;
  const rowPitch = gridHeight / ROLL_NUMBER_OPTIONS;

  const gridRight = contentRight;
  const gridLeft = gridRight - ROLL_GRID_WIDTH;
  const colPitch = ROLL_GRID_WIDTH / ROLL_NUMBER_DIGIT_COLUMNS;

  const columns: RollDigitColumnGeometry[] = [];
  for (let columnIndex = 0; columnIndex < ROLL_NUMBER_DIGIT_COLUMNS; columnIndex++) {
    const colX = gridLeft + (columnIndex + 0.5) * colPitch;
    const options: BubbleGeometry[] = [];
    for (let digit = 0; digit < ROLL_NUMBER_OPTIONS; digit++) {
      options.push({
        optionIndex: digit,
        center: { x: colX, y: gridTop + (digit + 0.5) * rowPitch },
      });
    }
    columns.push({ columnIndex, options });
  }
  return columns;
}

function computeQuestions(
  questionCount: StockTemplateQuestionCount,
  contentLeft: number,
  contentRight: number,
  answerGridTop: number,
  contentBottom: number,
): QuestionGeometry[] {
  const { columns, rows } = GRID_LAYOUT_BY_QUESTION_COUNT[questionCount];
  const contentWidth = contentRight - contentLeft;
  const columnWidth = contentWidth / columns;
  const gridHeight = contentBottom - answerGridTop;
  const rowPitch = gridHeight / rows;

  const questions: QuestionGeometry[] = [];
  for (let questionNumber = 1; questionNumber <= questionCount; questionNumber++) {
    const indexInGrid = questionNumber - 1;
    const columnIndex = Math.floor(indexInGrid / rows);
    const rowIndex = indexInGrid % rows;

    const columnLeft = contentLeft + columnIndex * columnWidth;
    const bubblesLeft = columnLeft + QUESTION_LABEL_WIDTH;
    const bubblesWidth = columnWidth - QUESTION_LABEL_WIDTH;
    const bubblePitch = bubblesWidth / ANSWER_OPTIONS_PER_QUESTION;
    const rowY = answerGridTop + (rowIndex + 0.5) * rowPitch;

    const options: BubbleGeometry[] = [];
    for (let optionIndex = 0; optionIndex < ANSWER_OPTIONS_PER_QUESTION; optionIndex++) {
      options.push({
        optionIndex,
        center: { x: bubblesLeft + (optionIndex + 0.5) * bubblePitch, y: rowY },
      });
    }
    questions.push({ questionNumber, options });
  }
  return questions;
}

export function computeStockTemplateGeometry(
  questionCount: StockTemplateQuestionCount,
): TemplateGeometry {
  const markers = computeMarkerCenters();
  const contentLeft = markers.topLeft.x + MARKER_SIZE_PT / 2 + CONTENT_GAP;
  const contentRight = markers.topRight.x - MARKER_SIZE_PT / 2 - CONTENT_GAP;
  const contentTop = markers.topLeft.y + MARKER_SIZE_PT / 2 + CONTENT_GAP;
  const contentBottom = markers.bottomLeft.y - MARKER_SIZE_PT / 2 - CONTENT_GAP;

  const answerGridTop = contentTop + HEADER_HEIGHT + HEADER_TO_ANSWER_GRID_GAP;

  return {
    schemaVersion: 1,
    questionCount,
    pageWidthPt: PAGE_WIDTH_PT,
    pageHeightPt: PAGE_HEIGHT_PT,
    bubbleRadiusPt: BUBBLE_RADIUS_PT,
    markerSizePt: MARKER_SIZE_PT,
    markers,
    questions: computeQuestions(
      questionCount,
      contentLeft,
      contentRight,
      answerGridTop,
      contentBottom,
    ),
    rollNumberColumns: computeRollNumberColumns(contentRight, contentTop),
  };
}

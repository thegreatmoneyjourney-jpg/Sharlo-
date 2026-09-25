/**
 * Draws a full, real stock-template-geometry sheet — real ArUco markers
 * (`cv.generateImageMarker`, same technique `fixtures.ts` uses) plus
 * real bubble rings/fills at `geometry.ts`'s own computed positions —
 * for M2-004's end-to-end read+score verification. Distinct from
 * `fixtures.ts`'s `buildBubbleSheet`, which draws its own simplified
 * flat layout: this fixture exists specifically to prove
 * `map-geometry-to-frame.ts` + `read-answer-sheet.ts` correctly read
 * bubbles at the *real* stock-template positions a teacher's printed
 * sheet would actually have, not a synthetic layout invented for
 * earlier harness cases.
 */

import type { CornerName, Point } from '../../lib/scanning/corner-markers';
import { arucoDataGridForCorner, fullMarkerGrid } from '../../lib/templates/aruco-marker-patterns';
import type { TemplateGeometry } from '../../lib/templates/geometry';
import { SAMPLE_RADIUS_RATIO } from '../../lib/templates/map-geometry-to-frame';

export function drawStockMarkers(ctx: CanvasRenderingContext2D, geometry: TemplateGeometry): void {
  const corners = Object.entries(geometry.markers) as [CornerName, { x: number; y: number }][];
  for (const [corner, center] of corners) {
    const grid = fullMarkerGrid(arucoDataGridForCorner(corner));
    const cellSize = geometry.markerSizePt / grid.length;
    const left = center.x - geometry.markerSizePt / 2;
    const top = center.y - geometry.markerSizePt / 2;
    ctx.fillStyle = 'black';
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        if (grid[row]![col] !== 1) continue;
        ctx.fillRect(left + col * cellSize, top + row * cellSize, cellSize, cellSize);
      }
    }
  }
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  radius: number,
  filled: boolean,
): void {
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (filled) {
    // Matches the radius map-geometry-to-frame.ts actually samples at
    // (SAMPLE_RADIUS_RATIO of the printed outline, not the full outline
    // radius) — see that constant's doc comment for why the sampled
    // region must stay strictly inside the printed ring.
    ctx.fillStyle = 'black';
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * SAMPLE_RADIUS_RATIO, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface StockSheetAnswers {
  /** One entry per question, in `geometry.questions` order — the optionIndex to fill, or `null` to leave that question blank. */
  questionAnswers: (number | null)[];
  /** One entry per roll-number column, in `geometry.rollNumberColumns` order — the digit (0-9) to fill, or `null` to leave that column blank. */
  rollNumberDigits: (number | null)[];
}

export interface BuiltStockSheet {
  canvas: HTMLCanvasElement;
  /** `geometry.markers`, scaled by the same factor the canvas itself was rendered at — the coordinate space `simulateTilt`/corner detection actually need, since `geometry.markers` alone is in unscaled PDF-point units. */
  scaledMarkers: Record<CornerName, Point>;
}

/**
 * `scale` renders at `scale`x the geometry's raw PDF-point-as-pixel
 * convention (1 PDF point = 1 canvas px at `scale: 1`) — found
 * empirically necessary, not a default: at `scale: 1`, a 20-question
 * sheet's dewarped output is only ~492px wide, giving each bubble only
 * a ~4px sampling radius. Real ArUco corner detection carries a few
 * pixels of sub-pixel-refinement error even in the noiseless case this
 * harness draws (`runStockTemplateMarkerCheck`'s own test tolerates up
 * to 3px), and at that tiny scale the resulting few-pixel bubble-position
 * error was large enough, relative to the bubble itself, to read several
 * genuinely-empty bubbles as `ambiguous` — see `docs/reports/
 * SHARLO-M2-004.md`. A real phone-camera capture is typically far
 * higher-resolution than 492px across the answer area, so this scale-up
 * makes the fixture representative of that, not just large enough to
 * dodge the failure.
 */
export function buildStockSheetCanvas(
  geometry: TemplateGeometry,
  answers: StockSheetAnswers,
  scale: number,
): BuiltStockSheet {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(geometry.pageWidthPt * scale);
  canvas.height = Math.ceil(geometry.pageHeightPt * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.scale(scale, scale); // every draw call below stays in raw PDF-point coordinates

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, geometry.pageWidthPt, geometry.pageHeightPt);

  drawStockMarkers(ctx, geometry);

  geometry.questions.forEach((question, qi) => {
    const answerIndex = answers.questionAnswers[qi] ?? null;
    for (const option of question.options) {
      drawBubble(ctx, option.center, geometry.bubbleRadiusPt, option.optionIndex === answerIndex);
    }
  });

  geometry.rollNumberColumns.forEach((column, ci) => {
    const digit = answers.rollNumberDigits[ci] ?? null;
    for (const option of column.options) {
      drawBubble(ctx, option.center, geometry.bubbleRadiusPt, option.optionIndex === digit);
    }
  });

  const scaledMarkers = Object.fromEntries(
    Object.entries(geometry.markers).map(([name, p]) => [
      name,
      { x: (p as Point).x * scale, y: (p as Point).y * scale },
    ]),
  ) as Record<CornerName, Point>;

  return { canvas, scaledMarkers };
}

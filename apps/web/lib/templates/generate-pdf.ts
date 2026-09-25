/**
 * Renders a `TemplateGeometry` (geometry.ts) to a printable PDF —
 * `pdf-lib`, no headless-browser/print-to-PDF step needed, and no image
 * assets: corner markers are drawn as plain vector rectangles from
 * `aruco-marker-patterns.ts`'s verified bit grids, which prints more
 * crisply at arbitrary printer DPI than an embedded raster marker would.
 *
 * `geometry.ts` works entirely in a top-left-origin, y-down coordinate
 * space (matching every other coordinate space in `lib/scanning`);
 * `pdf-lib` is bottom-left-origin, y-up. This module is the one place
 * that conversion happens (`toPdfY`) — every other module stays in the
 * top-left convention.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { CornerName } from '../scanning/corner-markers';
import { arucoDataGridForCorner, fullMarkerGrid } from './aruco-marker-patterns';
import { MAX_CUSTOM_OPTIONS_PER_QUESTION } from './geometry';
import type { BubbleGeometry, TemplateGeometry } from './geometry';

const CORNER_NAMES: readonly CornerName[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
/**
 * Sized to `MAX_CUSTOM_OPTIONS_PER_QUESTION` (geometry.ts), not a fixed
 * 4 — a custom template (M2-003) can have any option count up to that
 * bound, and indexing past a fixed-length array here would print
 * `undefined` as a bubble's letter label. Every stock template still
 * only ever uses the first 4 (A-D).
 */
const OPTION_LETTERS = Array.from({ length: MAX_CUSTOM_OPTIONS_PER_QUESTION }, (_, i) =>
  String.fromCharCode(65 + i),
);

function toPdfY(geometryY: number, pageHeightPt: number): number {
  return pageHeightPt - geometryY;
}

function drawMarker(
  page: PDFPage,
  centerX: number,
  centerY: number,
  sizePt: number,
  pageHeightPt: number,
  corner: CornerName,
): void {
  const grid = fullMarkerGrid(arucoDataGridForCorner(corner));
  const cellSize = sizePt / grid.length;
  const leftX = centerX - sizePt / 2;
  const topPdfY = toPdfY(centerY - sizePt / 2, pageHeightPt);

  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (grid[row][col] !== 1) continue;
      page.drawRectangle({
        x: leftX + col * cellSize,
        y: topPdfY - (row + 1) * cellSize,
        width: cellSize,
        height: cellSize,
        color: rgb(0, 0, 0),
      });
    }
  }
}

function drawBubble(
  page: PDFPage,
  bubble: BubbleGeometry,
  radiusPt: number,
  pageHeightPt: number,
): void {
  page.drawEllipse({
    x: bubble.center.x,
    y: toPdfY(bubble.center.y, pageHeightPt),
    xScale: radiusPt,
    yScale: radiusPt,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });
}

function drawCenteredLabel(
  page: PDFPage,
  text: string,
  centerX: number,
  geometryY: number,
  pageHeightPt: number,
  font: PDFFont,
  size: number,
): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: centerX - width / 2,
    y: toPdfY(geometryY, pageHeightPt) - size / 2.6, // rough visual vertical centering on the baseline
    size,
    font,
    color: rgb(0, 0, 0),
  });
}

export async function generateTemplatePdf(geometry: TemplateGeometry): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([geometry.pageWidthPt, geometry.pageHeightPt]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const corner of CORNER_NAMES) {
    const center = geometry.markers[corner];
    drawMarker(page, center.x, center.y, geometry.markerSizePt, geometry.pageHeightPt, corner);
  }

  page.drawText(`Sharlo — ${geometry.questionCount}-question answer sheet`, {
    x: geometry.markerSizePt + 20,
    y: toPdfY(geometry.markers.topLeft.y - geometry.markerSizePt / 2 - 4, geometry.pageHeightPt),
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  const nameLineY = geometry.markers.topLeft.y + geometry.markerSizePt / 2 + 26;
  page.drawText('Name: ______________________________', {
    x: geometry.markers.topLeft.x + geometry.markerSizePt / 2 + 20,
    y: toPdfY(nameLineY, geometry.pageHeightPt),
    size: 10,
    font,
  });

  if (geometry.rollNumberColumns.length > 0) {
    const firstColumn = geometry.rollNumberColumns[0];
    const lastColumn = geometry.rollNumberColumns[geometry.rollNumberColumns.length - 1];
    const rollGridCenterX = (firstColumn.options[0].center.x + lastColumn.options[0].center.x) / 2;
    drawCenteredLabel(
      page,
      'Roll Number',
      rollGridCenterX,
      firstColumn.options[0].center.y - 16,
      geometry.pageHeightPt,
      boldFont,
      9,
    );
  }

  for (const column of geometry.rollNumberColumns) {
    for (const option of column.options) {
      drawBubble(page, option, geometry.bubbleRadiusPt, geometry.pageHeightPt);
      drawCenteredLabel(
        page,
        String(option.optionIndex),
        option.center.x,
        option.center.y,
        geometry.pageHeightPt,
        font,
        7,
      );
    }
  }

  const optionLetterLabelOffsetPt = 10;
  const printedColumnHeaders = new Set<number>();
  for (const question of geometry.questions) {
    const labelX = question.options[0].center.x - 18;
    drawCenteredLabel(
      page,
      `${question.questionNumber}.`,
      labelX,
      question.options[0].center.y,
      geometry.pageHeightPt,
      font,
      8,
    );

    for (const option of question.options) {
      drawBubble(page, option, geometry.bubbleRadiusPt, geometry.pageHeightPt);
    }

    if (!printedColumnHeaders.has(labelX)) {
      printedColumnHeaders.add(labelX);
      for (const option of question.options) {
        drawCenteredLabel(
          page,
          OPTION_LETTERS[option.optionIndex],
          option.center.x,
          question.options[0].center.y - optionLetterLabelOffsetPt * 1.6,
          geometry.pageHeightPt,
          boldFont,
          7,
        );
      }
    }
  }

  return pdfDoc.save();
}

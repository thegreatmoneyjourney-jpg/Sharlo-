/**
 * Synthetic fixtures for M2-003's two new detection modules
 * (`detect-sheet-boundary.ts`, `detect-bubble-grid.ts`) — the same
 * canvas-drawn, fully-reproducible-from-source approach `fixtures.ts`
 * established for M1-010, in a separate file rather than added to it:
 * these two modules solve a different problem (finding an *arbitrary*
 * sheet/grid in a photo that has no ArUco markers) than the rest of the
 * harness (reading a *known* Sharlo template), and keeping them apart
 * means neither file's fixtures need to account for the other's
 * assumptions.
 *
 * Ports the exact synthetic scenarios that empirically validated these
 * two modules' algorithm choices in a scratchpad probe before either was
 * written (see `docs/reports/SHARLO-M2-003.md`) — this harness exercises
 * the real shipped modules against those same scenarios, not a
 * throwaway script, so a future change that breaks either algorithm is
 * caught by CI.
 */

import type { Point } from '../../lib/scanning/corner-markers';

export interface SyntheticSheetPhoto {
  canvas: HTMLCanvasElement;
  /** topLeft, topRight, bottomRight, bottomLeft — matches `detectSheetBoundary`'s own return order. */
  groundTruthCorners: [Point, Point, Point, Point];
}

/**
 * A light quadrilateral ("paper") on a darker background ("desk"),
 * either a simple in-plane rotation (`angleDeg`) or an explicit
 * arbitrary quadrilateral (`corners`, for simulating true perspective
 * foreshortening — a real phone photo isn't just rotated).
 */
export function buildSyntheticSheetPhoto(opts: {
  width?: number;
  height?: number;
  angleDeg?: number;
  corners?: [Point, Point, Point, Point];
  /** Skips drawing any sheet at all, leaving a uniform-color canvas with no contrast for Otsu to separate — exercises `detectSheetBoundary`'s "nothing found" `null` path against a real image, not just its unit-tested area-fraction guard. */
  blank?: boolean;
}): SyntheticSheetPhoto {
  const width = opts.width ?? 400;
  const height = opts.height ?? 300;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.fillStyle = '#404040';
  ctx.fillRect(0, 0, width, height);

  if (opts.blank) {
    // No sheet drawn — placeholder corners never checked by the caller
    // for a blank fixture.
    const placeholder: Point = { x: 0, y: 0 };
    return { canvas, groundTruthCorners: [placeholder, placeholder, placeholder, placeholder] };
  }

  let corners: [Point, Point, Point, Point];
  if (opts.corners) {
    corners = opts.corners;
  } else {
    const angleDeg = opts.angleDeg ?? 0;
    const cx = width / 2;
    const cy = height / 2;
    const w = width * 0.55;
    const h = height * 0.85;
    const angle = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const local: Point[] = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ];
    corners = local.map(({ x, y }) => ({
      x: cx + x * cos - y * sin,
      y: cy + x * sin + y * cos,
    })) as [Point, Point, Point, Point];
  }

  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fillStyle = '#f2f2f2';
  ctx.fill();

  return { canvas, groundTruthCorners: corners };
}

/**
 * A rows x columns grid of ring bubbles on white — represents the
 * *dewarped* sheet interior `detect-bubble-grid.ts` expects, never a raw
 * un-warped photo (see that module's file-level doc comment).
 */
export function buildSyntheticBubbleGridPhoto(opts: {
  rows: number;
  columns: number;
  cellWidth?: number;
  cellHeight?: number;
  marginX?: number;
  marginY?: number;
  radius?: number;
}): HTMLCanvasElement {
  const cellWidth = opts.cellWidth ?? 36;
  const cellHeight = opts.cellHeight ?? 24;
  const marginX = opts.marginX ?? 20;
  const marginY = opts.marginY ?? 20;
  const radius = opts.radius ?? 8;
  const width = marginX * 2 + opts.columns * cellWidth;
  const height = marginY * 2 + opts.rows * cellHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#202020';
  ctx.lineWidth = 2;

  for (let r = 0; r < opts.rows; r++) {
    for (let c = 0; c < opts.columns; c++) {
      const cx = marginX + (c + 0.5) * cellWidth;
      const cy = marginY + (r + 0.5) * cellHeight;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  return canvas;
}

/**
 * Bubble-grid estimation from a dewarped custom-template photo (M2-003,
 * FR-TPL-02) — estimates how many question-rows and options-per-question
 * (columns) a teacher's existing sheet has, so a fresh Sharlo-generated
 * template (real ArUco markers, `lib/templates/geometry.ts`'s own
 * regular-grid layout) can be sized to match. This module never tries to
 * recover each bubble's *exact* position from the photo — only the grid
 * *shape* (row/column counts) — because the actual template that gets
 * used for scoring is always a freshly-generated Sharlo PDF (per
 * `docs/ARCHITECTURE.md` §13: "only the derived geometry may be
 * persisted"), never the photographed sheet itself.
 *
 * **`FR-TPL-02`'s own framing is explicit that this is approximate**:
 * "a fundamentally harder, less-constrained problem... we don't promise
 * unattended accuracy there" (`docs/ARCHITECTURE.md` §4), which is why
 * the product requires a manual add/remove-rows/columns review step
 * regardless of what this module estimates. This module's job is to
 * produce a *reasonable starting point*, not a confident final answer —
 * matching NFR-ACC-03's "flag, don't guess" principle applied at the
 * template-creation layer: `estimateBubbleGrid` reports its own
 * `confident` flag rather than ever presenting a shaky guess as solid,
 * so calling UI code can visibly communicate "we guessed — please check
 * this" instead of hiding the uncertainty.
 *
 * **Detection technique, empirically verified in a real browser** (see
 * `docs/reports/SHARLO-M2-003.md` for the scratchpad probe this is
 * based on — never assumed from an OpenCV tutorial): `cv.HoughCircles`
 * (confirmed present; `cv.HOUGH_GRADIENT === 3` in this build, not
 * assumed), searching a radius range **derived purely from the image's
 * own dimensions** (2%–8% of the shorter side) rather than any
 * a-priori known bubble size — production input is an arbitrary
 * teacher photo, so there's no "expected radius" to hand it, and a
 * fixed-pixel radius range tuned against one test image would silently
 * fail to generalize. Verified against 4 synthetic grids spanning a
 * >2.5x range of radii and canvas sizes (6×4 up to 30×5) with **zero**
 * false positives/negatives and exact row/column recovery on clean,
 * uniformly-drawn ring bubbles in every case.
 *
 * **What this proves and what it doesn't** (same honest distinction
 * `docs/reports/SHARLO-M1-010.md` drew for the whole detection engine):
 * this proves the clustering *algorithm* is sound and the OpenCV calls
 * are correctly signatured — it does **not** establish real-world
 * accuracy against arbitrary photos of arbitrary real sheets (different
 * bubble shapes, ink colors, paper texture, lighting, partial fills on
 * a "blank" sample that isn't actually blank). That gap is exactly why
 * the confidence gate and mandatory review UI exist, not a follow-up
 * task to close later.
 */

import type { CvMat, Point } from '../scanning/corner-markers';
import type { OpenCvRuntime } from '../scanning/opencv-loader';

export interface DetectBubbleGridCv extends OpenCvRuntime {
  cvtColor: (src: CvMat, dst: CvMat, code: number) => void;
  GaussianBlur: (src: CvMat, dst: CvMat, ksize: unknown, sigmaX: number) => void;
  HoughCircles: (
    image: CvMat,
    circles: CvMat,
    method: number,
    dp: number,
    minDist: number,
    param1: number,
    param2: number,
    minRadius: number,
    maxRadius: number,
  ) => void;
  Size: new (width: number, height: number) => unknown;
  Mat: new () => CvMat & { cols: number; data32F: Float32Array };
  COLOR_RGBA2GRAY: number;
  HOUGH_GRADIENT: number;
}

export interface DetectedCircle extends Point {
  radius: number;
}

export interface EstimatedBubbleGrid {
  rows: number;
  columns: number;
  /** False whenever the fallback default below was used instead of a real clustering result. */
  confident: boolean;
}

/** Radius search range, as a fraction of the image's shorter side — see file-level doc comment for why this is self-scaling rather than a fixed pixel range. */
const MIN_RADIUS_FRACTION = 0.02;
const MAX_RADIUS_FRACTION = 0.08;

/** A row must be within this factor of the typical (median) bubble radius from the previous one to be considered the same row, not a new one. */
const ROW_GAP_RADIUS_FACTOR = 1.5;

const MIN_CONFIDENT_ROWS = 3;
const MIN_CONFIDENT_COLUMNS = 2;
/** At least this fraction of detected rows must share the modal column count for the result to be trusted — otherwise the detected "grid" is too ragged to be a real uniform MCQ layout. */
const MIN_ROW_CONSISTENCY_RATIO = 0.7;

/** Used whenever detection isn't confident — matches the smallest stock preset (`geometry.ts`), a reasonable universal starting point the teacher adjusts via the mandatory review UI. */
export const DEFAULT_GRID: EstimatedBubbleGrid = { rows: 20, columns: 4, confident: false };

/** Sane upper bound protecting the generated PDF's legibility against a pathological detection result (extreme false-positive count). */
const MAX_ROWS = 200;
const MAX_COLUMNS = 10;

/**
 * Runs `HoughCircles` against `image` (expected to already be the
 * dewarped, perspective-corrected sheet — never the raw un-warped
 * photo) with self-scaling search bounds. Pure OpenCV wrapper; the
 * clustering logic below is what's actually unit-tested without a
 * browser.
 */
export function detectCircles(
  cv: DetectBubbleGridCv,
  image: CvMat & { rows: number; cols: number },
): DetectedCircle[] {
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const circles = new cv.Mat();

  try {
    const shorterSide = Math.min(image.rows, image.cols);
    const minRadius = Math.max(2, Math.round(shorterSide * MIN_RADIUS_FRACTION));
    const maxRadius = Math.max(minRadius + 1, Math.round(shorterSide * MAX_RADIUS_FRACTION));
    const minDist = minRadius * ROW_GAP_RADIUS_FACTOR;

    cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT, 1, minDist, 80, 22, minRadius, maxRadius);

    const detected: DetectedCircle[] = [];
    for (let i = 0; i < circles.cols; i++) {
      detected.push({
        x: circles.data32F[i * 3]!,
        y: circles.data32F[i * 3 + 1]!,
        radius: circles.data32F[i * 3 + 2]!,
      });
    }
    return detected;
  } finally {
    gray.delete();
    blurred.delete();
    circles.delete();
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  let best = values[0]!;
  let bestCount = 0;
  for (const v of values) {
    const count = (counts.get(v) ?? 0) + 1;
    counts.set(v, count);
    if (count > bestCount) {
      bestCount = count;
      best = v;
    }
  }
  return best;
}

/**
 * Clusters detected circle centers into rows (by y, gap-based) and then
 * takes the modal row size as the column count — pure geometry, no
 * OpenCV involved, so directly unit-testable. Returns `confident: false`
 * (with `DEFAULT_GRID`'s values) whenever the result doesn't look like a
 * real uniform grid, rather than reporting a ragged/noisy clustering as
 * if it were reliable — see file-level doc comment.
 */
export function clusterCirclesIntoGrid(circles: readonly DetectedCircle[]): EstimatedBubbleGrid {
  if (circles.length === 0) return DEFAULT_GRID;

  const typicalRadius = median(circles.map((c) => c.radius));
  const rowGapThreshold = typicalRadius * ROW_GAP_RADIUS_FACTOR;

  const sortedByY = [...circles].sort((a, b) => a.y - b.y);
  const rows: DetectedCircle[][] = [[sortedByY[0]!]];
  for (let i = 1; i < sortedByY.length; i++) {
    const current = sortedByY[i]!;
    const prevRow = rows[rows.length - 1]!;
    const prevY = prevRow[prevRow.length - 1]!.y;
    if (current.y - prevY > rowGapThreshold) {
      rows.push([current]);
    } else {
      prevRow.push(current);
    }
  }

  const rowSizes = rows.map((row) => row.length);
  const modalColumns = mode(rowSizes);
  const consistentRowCount = rowSizes.filter((size) => size === modalColumns).length;
  const consistencyRatio = consistentRowCount / rows.length;

  const confident =
    rows.length >= MIN_CONFIDENT_ROWS &&
    modalColumns >= MIN_CONFIDENT_COLUMNS &&
    consistencyRatio >= MIN_ROW_CONSISTENCY_RATIO;

  if (!confident) return DEFAULT_GRID;

  return {
    rows: Math.min(rows.length, MAX_ROWS),
    columns: Math.min(modalColumns, MAX_COLUMNS),
    confident: true,
  };
}

/** Orchestrates detection + clustering against a real OpenCV runtime. */
export function estimateBubbleGrid(
  cv: DetectBubbleGridCv,
  dewarpedImage: CvMat & { rows: number; cols: number },
): EstimatedBubbleGrid {
  return clusterCirclesIntoGrid(detectCircles(cv, dewarpedImage));
}

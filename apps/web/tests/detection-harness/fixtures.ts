/**
 * Deterministic synthetic bubble-sheet fixtures for the detection-engine
 * test harness (M1-010, NFR-ACC-01–04).
 *
 * Draws the same kind of content a real printed-and-scanned sheet would
 * show — real ArUco corner markers via `cv.generateImageMarker`, real
 * ringed/filled bubbles via canvas 2D drawing — onto a real `<canvas>`,
 * reusing the exact techniques verified directly in a browser during
 * M1-005/M1-006 (see docs/reports/SHARLO-M1-005.md, SHARLO-M1-006.md).
 * This is deliberately real rasterized, anti-aliased pixel content, not
 * hand-built `ImageData` arrays — that's the gap this harness closes that
 * `corner-markers.test.ts` (mocked `cv`) and `bubble-fill.test.ts`
 * (hand-typed arrays) structurally can't.
 *
 * Checked-in generator code, not binary sample images: every fixture here
 * is fully reproducible from source, reviewable as a plain-text diff, and
 * free to parameterize (new tilt angles, grid shapes, fill patterns)
 * without adding binary files to the repo. See docs/reports/
 * SHARLO-M1-010.md for why this reading of TASKS.md's "sample sheet
 * images (with known ground truth)" was chosen over checked-in PNGs.
 */

import type { CornerName, CvMat, DetectedCorner, Point } from '../../lib/scanning/corner-markers';
import { CORNER_MARKER_IDS } from '../../lib/scanning/corner-markers';
import { computeNormalizedSize } from '../../lib/scanning/perspective-transform';

/** Minimal `cv` surface fixture-building needs — drawing markers/bubbles and simulating a camera tilt via a whole-canvas warp. Kept flat rather than extending `ArucoCv`/`PerspectiveCv` (their `Mat` member shapes differ and aren't meant to be combined) — same reason `use-corner-detection.ts`/`use-dewarp.ts` each cast the same runtime `cv` object to a different narrow interface at their own call sites instead of unifying one. */
export interface HarnessCv {
  getPredefinedDictionary: (dictId: number) => unknown;
  generateImageMarker: (
    dictionary: unknown,
    id: number,
    sidePixels: number,
    outputImg: CvMat,
    borderBits: number,
  ) => void;
  cvtColor: (src: CvMat, dst: CvMat, code: number) => void;
  COLOR_GRAY2RGBA: number;
  imshow: (canvas: HTMLCanvasElement, mat: CvMat) => void;
  matFromImageData: (imageData: ImageData) => ClonableMat;
  matFromArray: (rows: number, cols: number, type: number, data: number[]) => CvMat;
  getPerspectiveTransform: (src: CvMat, dst: CvMat) => CvMat;
  warpPerspective: (
    src: CvMat,
    dst: CvMat,
    M: CvMat,
    dsize: unknown,
    flags: number,
    borderMode: number,
  ) => void;
  Size: new (width: number, height: number) => unknown;
  Mat: new () => ClonableMat;
  CV_32FC2: number;
  INTER_LINEAR: number;
  BORDER_CONSTANT: number;
}

/** `CvMat` (corner-markers.ts) widened with `.clone()` — not part of that hand-typed surface since no existing caller needed it, but real OpenCV Mats have it and this harness does (to reuse one rendered flat sheet as its own untilted/0° "tilted" case). */
export type ClonableMat = CvMat & { clone: () => CvMat };

export const CANVAS_WIDTH_PX = 900;
export const CANVAS_HEIGHT_PX = 1200;
export const MARKER_SIZE_PX = 80;
export const MARKER_MARGIN_PX = 40;
/** Gap between the markers' own footprint and where bubble content starts. */
const CONTENT_PADDING_PX = 30;
/** Printed bubble outline radius. */
export const BUBBLE_OUTLINE_RADIUS_PX = 16;
/** Sampling radius used both when drawing a bubble's fill and when reading it back — deliberately smaller than the outline so the sampled region never includes the printed ring itself, same as a real template's bubble region would avoid sampling right up to the ink boundary. */
export const SAMPLE_RADIUS_PX = 13;

export interface FlatRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface FlatMarkerLayout {
  positions: Record<CornerName, Point>;
  centers: Record<CornerName, Point>;
  rect: FlatRect;
}

/** The 4 corner markers' flat (untilted, as-drawn) positions/centers for a canvas of the given size — a true axis-aligned rectangle, which is what makes `expectedDewarpedPoint`'s scale/translate math exact rather than approximate (see that function's doc comment). */
function flatMarkerLayout(canvasWidth: number, canvasHeight: number): FlatMarkerLayout {
  const positions: Record<CornerName, Point> = {
    topLeft: { x: MARKER_MARGIN_PX, y: MARKER_MARGIN_PX },
    topRight: { x: canvasWidth - MARKER_MARGIN_PX - MARKER_SIZE_PX, y: MARKER_MARGIN_PX },
    bottomRight: {
      x: canvasWidth - MARKER_MARGIN_PX - MARKER_SIZE_PX,
      y: canvasHeight - MARKER_MARGIN_PX - MARKER_SIZE_PX,
    },
    bottomLeft: {
      x: MARKER_MARGIN_PX,
      y: canvasHeight - MARKER_MARGIN_PX - MARKER_SIZE_PX,
    },
  };
  const centers = Object.fromEntries(
    Object.entries(positions).map(([name, pos]) => [
      name,
      { x: pos.x + MARKER_SIZE_PX / 2, y: pos.y + MARKER_SIZE_PX / 2 },
    ]),
  ) as Record<CornerName, Point>;
  const rect: FlatRect = {
    left: centers.topLeft.x,
    top: centers.topLeft.y,
    right: centers.topRight.x,
    bottom: centers.bottomLeft.y,
  };
  return { positions, centers, rect };
}

function drawCornerMarkers(
  cv: HarnessCv,
  ctx: CanvasRenderingContext2D,
  positions: Record<CornerName, Point>,
): void {
  for (const [name, id] of Object.entries(CORNER_MARKER_IDS)) {
    const markerMat = new cv.Mat();
    cv.generateImageMarker(cv.getPredefinedDictionary(0), id, MARKER_SIZE_PX, markerMat, 1);
    const rgba = new cv.Mat();
    cv.cvtColor(markerMat, rgba, cv.COLOR_GRAY2RGBA);

    const tmp = document.createElement('canvas');
    tmp.width = MARKER_SIZE_PX;
    tmp.height = MARKER_SIZE_PX;
    cv.imshow(tmp, rgba);

    const pos = positions[name as CornerName];
    ctx.drawImage(tmp, pos.x, pos.y);

    markerMat.delete();
    rgba.delete();
  }
}

/**
 * Draws one bubble: the printed outline (always present) plus, if
 * `fillFraction > 0`, an inner filled disk scaled so its AREA covers
 * `fillFraction` of the sampling disk — a disk of radius
 * `r * sqrt(fillFraction)` has area `fillFraction * (area of radius r)`.
 * `fillFraction` is expressed relative to `SAMPLE_RADIUS_PX`, not the
 * (larger) outline radius, since that's the region `sampleBubbleFillRatio`
 * actually measures — see that constant's doc comment.
 */
function drawBubble(ctx: CanvasRenderingContext2D, center: Point, fillFraction: number): void {
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center.x, center.y, BUBBLE_OUTLINE_RADIUS_PX, 0, Math.PI * 2);
  ctx.stroke();

  if (fillFraction <= 0) return;

  const fillRadius = SAMPLE_RADIUS_PX * Math.sqrt(Math.min(fillFraction, 1));
  ctx.fillStyle = 'black';
  ctx.beginPath();
  ctx.arc(center.x, center.y, fillRadius, 0, Math.PI * 2);
  ctx.fill();
}

export interface BuiltSheet {
  canvas: HTMLCanvasElement;
  flatRect: FlatRect;
  flatCenters: Record<CornerName, Point>;
  /** One inner array per group (question or digit column), each entry that option's flat-canvas center point, in the same order as the requested fill fractions. */
  groupFlatCenters: Point[][];
}

/**
 * Draws a full synthetic sheet: white background, the 4 corner markers,
 * and one row per entry in `groups` (a question or, equally, a
 * roll-number digit column — both are just "a group of N option bubbles"
 * from the detection pipeline's point of view, per roll-number.ts's own
 * documented reasoning), each option spaced evenly across the row.
 */
export function buildBubbleSheet(cv: HarnessCv, groups: number[][]): BuiltSheet {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH_PX;
  canvas.height = CANVAS_HEIGHT_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const layout = flatMarkerLayout(canvas.width, canvas.height);
  drawCornerMarkers(cv, ctx, layout.positions);

  const contentLeft = MARKER_MARGIN_PX + MARKER_SIZE_PX + CONTENT_PADDING_PX;
  const contentRight = canvas.width - MARKER_MARGIN_PX - MARKER_SIZE_PX - CONTENT_PADDING_PX;
  const contentTop = MARKER_MARGIN_PX + MARKER_SIZE_PX + CONTENT_PADDING_PX;
  const contentBottom = canvas.height - MARKER_MARGIN_PX - MARKER_SIZE_PX - CONTENT_PADDING_PX;

  const groupFlatCenters: Point[][] = groups.map((options, groupIndex) => {
    const rowY =
      groups.length === 1
        ? (contentTop + contentBottom) / 2
        : contentTop + (groupIndex * (contentBottom - contentTop)) / (groups.length - 1);

    return options.map((fillFraction, optionIndex) => {
      const colX =
        options.length === 1
          ? (contentLeft + contentRight) / 2
          : contentLeft + (optionIndex * (contentRight - contentLeft)) / (options.length - 1);
      const center = { x: colX, y: rowY };
      drawBubble(ctx, center, fillFraction);
      return center;
    });
  });

  return { canvas, flatRect: layout.rect, flatCenters: layout.centers, groupFlatCenters };
}

export function sheetToMat(cv: HarnessCv, canvas: HTMLCanvasElement): ClonableMat {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return cv.matFromImageData(imageData);
}

function pointsToArray(points: Record<CornerName, Point>): number[] {
  return [
    points.topLeft.x,
    points.topLeft.y,
    points.topRight.x,
    points.topRight.y,
    points.bottomRight.x,
    points.bottomRight.y,
    points.bottomLeft.x,
    points.bottomLeft.y,
  ];
}

/**
 * Simulates a sheet tilted `angleDeg` away from the camera at the top
 * edge — the same parametric-trapezoid (keystone) approximation used and
 * documented in M1-005's real-browser dewarp verification (not a
 * physically exact camera-projection model): squeezes the top edge's
 * marker centers toward the horizontal midpoint by `sin(angle) * 0.35` of
 * the canvas width per side, leaving the bottom edge (closer to camera)
 * unchanged. Warps the WHOLE canvas (not just marker positions) via a
 * single perspective transform, so every other drawn element — bubbles
 * included — moves consistently with the markers, exactly as a real
 * photograph of a tilted sheet would.
 */
export function simulateTilt(
  cv: HarnessCv,
  flatMat: ClonableMat,
  flatCenters: Record<CornerName, Point>,
  angleDeg: number,
  canvasWidth: number,
  canvasHeight: number,
): CvMat {
  if (angleDeg === 0) return flatMat.clone();

  const squeezePx = canvasWidth * Math.sin((angleDeg * Math.PI) / 180) * 0.35;
  const tiltedCenters: Record<CornerName, Point> = {
    topLeft: { x: flatCenters.topLeft.x + squeezePx, y: flatCenters.topLeft.y },
    topRight: { x: flatCenters.topRight.x - squeezePx, y: flatCenters.topRight.y },
    bottomRight: flatCenters.bottomRight,
    bottomLeft: flatCenters.bottomLeft,
  };

  const srcArr = cv.matFromArray(4, 1, cv.CV_32FC2, pointsToArray(flatCenters));
  const dstArr = cv.matFromArray(4, 1, cv.CV_32FC2, pointsToArray(tiltedCenters));
  const M = cv.getPerspectiveTransform(srcArr, dstArr);
  const out = new cv.Mat();
  cv.warpPerspective(
    flatMat,
    out,
    M,
    new cv.Size(canvasWidth, canvasHeight),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
  );
  srcArr.delete();
  dstArr.delete();
  M.delete();
  return out;
}

/**
 * Where a flat-sheet point ends up in `dewarpFrame`'s output, independent
 * of which tilt angle produced the input image.
 *
 * `dewarpFrame` maps whatever corners it *detects* in the input frame to
 * fixed destination corners — that's its entire job, undoing the tilt to
 * recover a canonical frame. Composing the forward tilt (flat markers →
 * tilted positions, a homography fit from those same 4 points) with the
 * real dewarp (detected tilted positions → destination corners, also
 * fit from 4 points) is mathematically exactly the same as the single
 * homography taking the flat markers directly to the destination corners
 * — a projective transform is uniquely determined by 4 point
 * correspondences, so going flat→tilted→dest by two such transforms
 * lands on precisely the same result as flat→dest directly, for any
 * point, not just the 4 corners themselves. And since both the flat
 * marker layout and `dewarpFrame`'s destination rect are true
 * axis-aligned rectangles with matching corner order, that direct
 * flat→dest homography has no perspective/shear component at all — it's
 * exactly a per-axis scale + translate. So this can be computed with
 * plain arithmetic, with no OpenCV call on the "expected" side at all,
 * and the same expected point is valid for every tilt angle's dewarped
 * output — a real disagreement beyond ordinary detection/rounding noise
 * means the dewarp genuinely isn't recovering the flat frame correctly.
 */
export function expectedDewarpedPoint(point: Point, flatRect: FlatRect, destRect: FlatRect): Point {
  const scaleX = (destRect.right - destRect.left) / (flatRect.right - flatRect.left);
  const scaleY = (destRect.bottom - destRect.top) / (flatRect.bottom - flatRect.top);
  return {
    x: destRect.left + (point.x - flatRect.left) * scaleX,
    y: destRect.top + (point.y - flatRect.top) * scaleY,
  };
}

/**
 * The destination rectangle `dewarpFrame` warps onto, derived the same
 * way `dewarpFrame` itself derives it (marker span padded by
 * `paddingRatio` on every side) but from the *flat* marker layout rather
 * than a particular tilt's detected corners — valid for every tilt angle
 * per `expectedDewarpedPoint`'s doc comment. Reuses `computeNormalizedSize`
 * (pure geometry, already unit-tested, no WASM/`cv` dependency) for the
 * output width/height rather than re-deriving that formula a second time;
 * only the padding fraction itself (not `dewarpFrame`'s internal
 * px-rounding of `padX`/`padY`) is reapplied here, which is fine given
 * callers compare against this with a pixel tolerance anyway.
 */
export function destRectFor(
  flatCenters: Record<CornerName, Point>,
  paddingRatio: number,
): FlatRect {
  const corners: Record<CornerName, DetectedCorner> = Object.fromEntries(
    Object.entries(flatCenters).map(([name, center]) => [
      name,
      { name: name as CornerName, center, markerCorners: [center, center, center, center] },
    ]),
  ) as Record<CornerName, DetectedCorner>;
  const { width, height } = computeNormalizedSize(corners, paddingRatio);
  return {
    left: width * paddingRatio,
    top: height * paddingRatio,
    right: width * (1 - paddingRatio),
    bottom: height * (1 - paddingRatio),
  };
}

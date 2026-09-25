/**
 * Perspective transform / dewarp (FR-DETECT-01) — framework-agnostic,
 * per ARCHITECTURE.md §3. Warps a captured frame to a normalized,
 * axis-aligned rectangle using the 4 detected corner markers, via
 * `cv.getPerspectiveTransform` + `cv.warpPerspective`. Both confirmed
 * present via real in-browser introspection (not text search — see
 * corner-markers.ts's doc comment for why that distinction matters on
 * this repo), unlike ArUco these are core, non-contrib OpenCV functions
 * so this was closer to a sanity check than a real "is this available"
 * question, but the exact signatures (argument order, `dsize` needing
 * a real `cv.Size` instance, `matFromArray`'s type-tag argument) were
 * still verified empirically rather than assumed.
 *
 * The output rectangle is derived from the observed marker positions
 * themselves, padded by `paddingRatio` (default 6%) on every side rather
 * than mapping marker centers exactly onto the output's edge pixels. A
 * real-browser round-trip check (detect -> dewarp -> re-detect the same
 * markers in the output) caught this: with zero padding, each corner
 * marker's own center sits exactly at an output corner, so half of every
 * marker's own footprint falls outside the output canvas and gets
 * clipped — confirmed empirically (all 4 test angles, including an
 * untilted 0° control, failed to re-detect any marker in the unpadded
 * output). See docs/reports/SHARLO-M1-005.md.
 *
 * **Bubble content itself is unaffected by this**, whatever the padding
 * ratio: real template geometry now exists (M2-001,
 * `lib/templates/geometry.ts`) and every bubble sits *inside* the
 * marker-to-marker rectangle, not beyond it, so `paddingRatio` never
 * needs to be large enough to "include the content" — content is already
 * included at padding=0. Its only real job is keeping each marker's own
 * printed footprint from clipping in the dewarped output. M2-001's real
 * numbers (25mm markers on a ~155mm marker span) mean that actually
 * needs ~8.1% (half a marker's size, as a fraction of the span), a bit
 * more than this default's 6% — so a marker's own ink *would* still clip
 * slightly today. Left as-is rather than bumped, since nothing in the
 * current pipeline re-detects markers in the dewarped output (bubble
 * sampling doesn't need them visible there) and changing this constant's
 * value is a real M1-pipeline behavior change needing its own
 * re-verification pass — out of scope for M2-001, which only needed to
 * find out the real number, not spend it. Flagged in
 * docs/reports/SHARLO-M2-001.md as a finding for whichever future task
 * first actually needs post-dewarp marker visibility.
 */

import type { CornerName, CvMat, DetectedCorner, Point } from './corner-markers';
import type { OpenCvRuntime } from './opencv-loader';

export interface PerspectiveCv extends OpenCvRuntime {
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
  Mat: new () => CvMat;
  CV_32FC2: number;
  INTER_LINEAR: number;
  BORDER_CONSTANT: number;
  /** Standard OpenCV.js way to get a Mat from a canvas's ImageData — same member corner-markers.ts's ArucoCv declares, needed here by use-dewarp.ts's input conversion. */
  matFromImageData: (imageData: ImageData) => CvMat;
  /** Standard OpenCV.js way to draw a Mat onto a canvas — used by use-dewarp.ts to read the warped result back out as ImageData. */
  imshow: (canvas: HTMLCanvasElement, mat: CvMat) => void;
}

export interface NormalizedSize {
  width: number;
  height: number;
}

export interface DewarpResult extends NormalizedSize {
  /** Caller-owned — delete() it once done, same lifecycle convention as every other Mat in this codebase. */
  mat: CvMat;
}

/** See the file-level doc comment for why this exists and what its value is pending. */
export const DEFAULT_PADDING_RATIO = 0.06;

function edgeLength(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface MarkerSpan {
  width: number;
  height: number;
}

/**
 * The raw marker-center-to-marker-center span, before padding. Uses the
 * larger of each opposite edge pair (top vs. bottom, left vs. right):
 * whichever edge is *closer* to the camera measures *larger* in pixels,
 * so taking the max approximates the sheet's true, unforeshortened size
 * better than an average would.
 */
function computeMarkerSpan(corners: Record<CornerName, DetectedCorner>): MarkerSpan {
  const { topLeft, topRight, bottomRight, bottomLeft } = corners;
  const topWidth = edgeLength(topLeft.center, topRight.center);
  const bottomWidth = edgeLength(bottomLeft.center, bottomRight.center);
  const leftHeight = edgeLength(topLeft.center, bottomLeft.center);
  const rightHeight = edgeLength(topRight.center, bottomRight.center);
  return {
    width: Math.max(topWidth, bottomWidth),
    height: Math.max(leftHeight, rightHeight),
  };
}

/** Pure geometry — no OpenCV involved, so this is directly unit-testable without a browser. */
export function computeNormalizedSize(
  corners: Record<CornerName, DetectedCorner>,
  paddingRatio: number = DEFAULT_PADDING_RATIO,
): NormalizedSize {
  const span = computeMarkerSpan(corners);
  return {
    width: Math.round(span.width * (1 + 2 * paddingRatio)),
    height: Math.round(span.height * (1 + 2 * paddingRatio)),
  };
}

/**
 * Warps `frame` so the 4 corner centers land on the output rectangle
 * inset by `paddingRatio` on every side (not exactly on its edge pixels
 * — see the file-level doc comment for why). Point order must match
 * between the source and destination point lists — both go topLeft,
 * topRight, bottomRight, bottomLeft here, matching corner-markers.ts's
 * own naming.
 */
export function dewarpFrame(
  cv: PerspectiveCv,
  frame: CvMat,
  corners: Record<CornerName, DetectedCorner>,
  paddingRatio: number = DEFAULT_PADDING_RATIO,
): DewarpResult {
  const { topLeft, topRight, bottomRight, bottomLeft } = corners;
  const span = computeMarkerSpan(corners);
  const width = Math.round(span.width * (1 + 2 * paddingRatio));
  const height = Math.round(span.height * (1 + 2 * paddingRatio));
  const padX = Math.round(span.width * paddingRatio);
  const padY = Math.round(span.height * paddingRatio);

  const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    topLeft.center.x,
    topLeft.center.y,
    topRight.center.x,
    topRight.center.y,
    bottomRight.center.x,
    bottomRight.center.y,
    bottomLeft.center.x,
    bottomLeft.center.y,
  ]);
  const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    padX,
    padY,
    width - padX,
    padY,
    width - padX,
    height - padY,
    padX,
    height - padY,
  ]);
  const transform = cv.getPerspectiveTransform(srcPoints, dstPoints);
  const output = new cv.Mat();

  try {
    cv.warpPerspective(
      frame,
      output,
      transform,
      new cv.Size(width, height),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
    );
  } catch (err) {
    output.delete();
    throw err;
  } finally {
    srcPoints.delete();
    dstPoints.delete();
    transform.delete();
  }

  return { mat: output, width, height };
}

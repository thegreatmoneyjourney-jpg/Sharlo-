/**
 * Corner fiducial marker detection (FR-DETECT-01, NFR-ACC-01) — framework-
 * agnostic, per ARCHITECTURE.md §3's requirement for `/lib/scanning`.
 *
 * Uses OpenCV's ArUco marker system (`cv.aruco_ArucoDetector` — verified
 * present and working in `@techstark/opencv-js`'s build directly in a
 * browser; its TypeScript declarations don't cover ArUco, and a plain
 * text search of the bundled file finds nothing because these bindings
 * live inside the compiled WASM binary, not as readable JS — neither is
 * a reliable way to check what this package actually exposes, only
 * loading it and inspecting `cv` at runtime is), not a hand-rolled
 * "find a dark square" contour heuristic: ArUco markers are a
 * purpose-built, well-tested solution for exactly this problem
 * (fiducial detection under real-world camera conditions — rotation,
 * partial perspective, uneven lighting), and each marker encodes an ID,
 * so a specific corner (top-left vs. bottom-right, etc.) is identified
 * directly rather than inferred from position, which stays correct even
 * if a sheet is picked up rotated.
 *
 * **Placeholder pending `M2-001`:** the specific dictionary and the 4
 * marker IDs below are a proposal to unblock this task, not a confirmed
 * product decision — `docs/TASKS.md`'s own milestone ordering has M2
 * (templates) depend on M1 (scanning core), but corner detection can't
 * be built or tested without *some* concrete marker definition to detect
 * against, and none exists yet (`templates.geometry`, ARCHITECTURE.md
 * §6, is empty until M2-001/M2-002 build the actual template system).
 * Flagged in `docs/reports/SHARLO-M1-003.md` rather than silently
 * decided — when M2-001 defines real templates, confirm these constants
 * still hold (or update every reference together, they're deliberately
 * centralized here as the single source of truth).
 */

import type { OpenCvRuntime } from './opencv-loader';

/** DICT_4X4_50: small (fast to detect, prints compact) and far more IDs than the 4 this needs. */
export const ARUCO_DICTIONARY_ID = 0;

export const CORNER_MARKER_IDS = {
  topLeft: 0,
  topRight: 1,
  bottomRight: 2,
  bottomLeft: 3,
} as const;

export type CornerName = keyof typeof CORNER_MARKER_IDS;

const CORNER_NAMES_BY_ID: Record<number, CornerName> = Object.fromEntries(
  Object.entries(CORNER_MARKER_IDS).map(([name, id]) => [id, name as CornerName]),
);

export interface Point {
  x: number;
  y: number;
}

export interface DetectedCorner {
  name: CornerName;
  /** Centroid of the marker's 4 points — the representative position for this corner. */
  center: Point;
  /** The marker's own 4 corner points, in the order OpenCV returns them. */
  markerCorners: [Point, Point, Point, Point];
}

export type CornerDetectionResult =
  | { complete: true; corners: Record<CornerName, DetectedCorner> }
  | { complete: false; found: Partial<Record<CornerName, DetectedCorner>> };

/**
 * Minimal surface of the ArUco types this module needs, hand-typed for
 * the same reason `OpenCvRuntime` is in `opencv-loader.ts` — the
 * package's own declarations don't cover ArUco, and its README warns
 * they can lag the actual build regardless.
 */
export interface CvMat {
  delete: () => void;
  rows: number;
  cols: number;
}
interface CvMatVector {
  size: () => number;
  get: (i: number) => CvMat & { data32F: Float32Array };
  delete: () => void;
}
interface CvArucoDetector {
  detectMarkers: (image: CvMat, corners: CvMatVector, ids: CvMat, rejected: CvMatVector) => void;
}
/**
 * `OpenCvRuntime` (opencv-loader.ts) widened with the specific ArUco
 * members this module uses — per that file's own doc comment, detection
 * code should extend it rather than maintain an unrelated parallel type.
 */
export interface ArucoCv extends OpenCvRuntime {
  getPredefinedDictionary: (dictId: number) => unknown;
  aruco_DetectorParameters: new () => { cornerRefinementMethod: number };
  aruco_RefineParameters: new (
    minRepDistance: number,
    errorCorrectionRate: number,
    checkAllOrders: boolean,
  ) => unknown;
  aruco_ArucoDetector: new (
    dictionary: unknown,
    params: unknown,
    refineParams: unknown,
  ) => CvArucoDetector;
  CORNER_REFINE_SUBPIX: number;
  MatVector: new () => CvMatVector;
  Mat: new () => CvMat & { rows: number; intPtr: (r: number, c: number) => Int32Array };
  /** Standard OpenCV.js way to get a Mat from a canvas's ImageData — used to pull frames off the live video. */
  matFromImageData: (imageData: ImageData) => CvMat;
}

/**
 * Owns the ArUco dictionary/params/detector — construct once (real,
 * measurable cost) and reuse across every frame, never recreate per
 * frame. `detect()` never guesses: a marker with an ID outside the 4
 * expected ones is ignored, and `complete: true` only when all 4 are
 * found — matching NFR-ACC-03's "flag, don't guess" principle at the
 * detection layer, not just the bubble-reading layer it was written for.
 */
export class CornerMarkerDetector {
  private readonly detector: CvArucoDetector;
  private readonly cv: ArucoCv;

  constructor(cv: ArucoCv) {
    this.cv = cv;
    const dictionary = cv.getPredefinedDictionary(ARUCO_DICTIONARY_ID);
    const params = new cv.aruco_DetectorParameters();
    params.cornerRefinementMethod = cv.CORNER_REFINE_SUBPIX;
    const refineParams = new cv.aruco_RefineParameters(10, 3, true);
    this.detector = new cv.aruco_ArucoDetector(dictionary, params, refineParams);
  }

  detect(frame: CvMat): CornerDetectionResult {
    const cv = this.cv;
    const corners = new cv.MatVector();
    const ids = new cv.Mat();
    const rejected = new cv.MatVector();

    try {
      this.detector.detectMarkers(frame, corners, ids, rejected);

      const found: Partial<Record<CornerName, DetectedCorner>> = {};
      for (let i = 0; i < ids.rows; i++) {
        const id = ids.intPtr(i, 0)[0];
        const name = CORNER_NAMES_BY_ID[id];
        if (!name) continue; // a marker we don't recognize as one of our 4 corners — ignore, don't guess

        const cornerMat = corners.get(i);
        const data = cornerMat.data32F; // 4 points, [x0,y0,x1,y1,x2,y2,x3,y3]
        const markerCorners: [Point, Point, Point, Point] = [
          { x: data[0], y: data[1] },
          { x: data[2], y: data[3] },
          { x: data[4], y: data[5] },
          { x: data[6], y: data[7] },
        ];
        const center = {
          x:
            (markerCorners[0].x + markerCorners[1].x + markerCorners[2].x + markerCorners[3].x) / 4,
          y:
            (markerCorners[0].y + markerCorners[1].y + markerCorners[2].y + markerCorners[3].y) / 4,
        };
        found[name] = { name, center, markerCorners };
        cornerMat.delete();
      }

      if (found.topLeft && found.topRight && found.bottomRight && found.bottomLeft) {
        return {
          complete: true,
          corners: {
            topLeft: found.topLeft,
            topRight: found.topRight,
            bottomRight: found.bottomRight,
            bottomLeft: found.bottomLeft,
          },
        };
      }
      return { complete: false, found };
    } finally {
      corners.delete();
      ids.delete();
      rejected.delete();
    }
  }
}

/**
 * Detection-engine test harness entry point (M1-010) — bundled by
 * `scripts/build-detection-harness.mjs` into an IIFE loaded by
 * `harness.html` after `opencv.js`. Exposes a small, serializable-in/out
 * API on `window.DetectionHarness` so `detection-engine.pw-spec.ts` can
 * drive it entirely through `page.evaluate()` calls, never passing a
 * `cv`/`Mat` handle across the Node↔browser boundary (those aren't
 * serializable, and per `opencv-loader.ts`'s own warning must never cross
 * a Promise boundary unwrapped anyway) — this module owns the one `cv`
 * handle internally instead, keyed off `cvReady`.
 *
 * Composes the same real product modules M1-003 through M1-009 built and
 * already unit-test — `CornerMarkerDetector`, `dewarpFrame`,
 * `sampleBubbleFillRatio`/`classifyQuestion`, `readRollNumber`/
 * `matchRollNumber` — driven by real rendered pixels from `fixtures.ts`
 * instead of mocked `cv` calls or hand-typed `ImageData`, closing the gap
 * those modules' own unit tests each flag as out of scope for exactly
 * that reason.
 */

import type { ArucoCv, CornerName, Point } from '../../lib/scanning/corner-markers';
import { CornerMarkerDetector } from '../../lib/scanning/corner-markers';
import type { PerspectiveCv } from '../../lib/scanning/perspective-transform';
import { DEFAULT_PADDING_RATIO, dewarpFrame } from '../../lib/scanning/perspective-transform';
import type { QuestionResult } from '../../lib/scanning/bubble-fill';
import {
  DEFAULT_FILL_THRESHOLDS,
  classifyQuestion,
  sampleBubbleFillRatio,
} from '../../lib/scanning/bubble-fill';
import type { RollNumberMatchResult, RollNumberReadResult } from '../../lib/scanning/roll-number';
import { matchRollNumber, readRollNumber } from '../../lib/scanning/roll-number';
import { arucoDataGridForCorner, fullMarkerGrid } from '../../lib/templates/aruco-marker-patterns';
import type { StockTemplateQuestionCount } from '../../lib/templates/geometry';
import { computeStockTemplateGeometry } from '../../lib/templates/geometry';
import type { SheetBoundaryCv } from '../../lib/templates/detect-sheet-boundary';
import { detectSheetBoundary } from '../../lib/templates/detect-sheet-boundary';
import type {
  DetectBubbleGridCv,
  EstimatedBubbleGrid,
} from '../../lib/templates/detect-bubble-grid';
import { estimateBubbleGrid } from '../../lib/templates/detect-bubble-grid';
import type { HarnessCv } from './fixtures';
import {
  SAMPLE_RADIUS_PX,
  buildBubbleSheet,
  destRectFor,
  expectedDewarpedPoint,
  sheetToMat,
  simulateTilt,
} from './fixtures';
import {
  buildSyntheticBubbleGridPhoto,
  buildSyntheticSheetPhoto,
} from './template-creation-fixtures';

let cvHandle: HarnessCv | undefined;

function requireCv(): HarnessCv {
  if (!cvHandle) {
    throw new Error(
      'DetectionHarness: cv is not ready yet — wait for window.DetectionHarness.cvReady',
    );
  }
  return cvHandle;
}

interface GroupClassification {
  cornerDetectionComplete: boolean;
  results: QuestionResult[];
}

/**
 * Shared by `runQuestionGridCase` and `runRollNumberCase` — a "question"
 * and a roll-number "digit column" are both just a group of option
 * bubbles from the detection pipeline's point of view (see
 * roll-number.ts's own doc comment), so both build one sheet, tilt it,
 * detect corners, dewarp, and classify every group's bubbles the same
 * way.
 */
function classifyGroups(tiltDeg: number, groups: number[][]): GroupClassification {
  const cv = requireCv();
  const built = buildBubbleSheet(cv, groups);
  const flatMat = sheetToMat(cv, built.canvas);
  const tilted = simulateTilt(
    cv,
    flatMat,
    built.flatCenters,
    tiltDeg,
    built.canvas.width,
    built.canvas.height,
  );
  flatMat.delete();

  const detector = new CornerMarkerDetector(cv as unknown as ArucoCv);
  const detection = detector.detect(tilted);

  if (!detection.complete) {
    tilted.delete();
    return {
      cornerDetectionComplete: false,
      results: groups.map(() => ({ outcome: 'flagged' as const })),
    };
  }

  const dewarped = dewarpFrame(cv as unknown as PerspectiveCv, tilted, detection.corners);
  tilted.delete();

  const dewarpedCanvas = document.createElement('canvas');
  dewarpedCanvas.width = dewarped.width;
  dewarpedCanvas.height = dewarped.height;
  (cv as unknown as PerspectiveCv).imshow(dewarpedCanvas, dewarped.mat);
  dewarped.mat.delete();

  const dewarpedCtx = dewarpedCanvas.getContext('2d');
  if (!dewarpedCtx) throw new Error('2D canvas context unavailable');
  const dewarpedImageData = dewarpedCtx.getImageData(0, 0, dewarped.width, dewarped.height);

  const destRect = destRectFor(built.flatCenters, DEFAULT_PADDING_RATIO);
  const results = built.groupFlatCenters.map((optionCenters) => {
    const ratios = optionCenters.map((flatCenter) => {
      const expected = expectedDewarpedPoint(flatCenter, built.flatRect, destRect);
      return sampleBubbleFillRatio(dewarpedImageData, {
        center: expected,
        radius: SAMPLE_RADIUS_PX,
      });
    });
    return classifyQuestion(ratios, DEFAULT_FILL_THRESHOLDS);
  });

  return { cornerDetectionComplete: true, results };
}

export interface CornerDetectionCaseResult {
  complete: boolean;
}

export interface QuestionGridCaseSpec {
  tiltDeg: number;
  /** One inner array per question; each entry is that option's requested fill fraction (0 = empty, 1 = fully filled). */
  questions: number[][];
}

export interface QuestionGridCaseResult {
  cornerDetectionComplete: boolean;
  questions: QuestionResult[];
}

export interface RollNumberCaseSpec {
  tiltDeg: number;
  /** One inner array per digit column (conventionally 10 entries, options 0-9); each entry that digit's requested fill fraction. */
  columns: number[][];
  roster: string[];
}

export interface RollNumberCaseResult {
  cornerDetectionComplete: boolean;
  read: RollNumberReadResult;
  match: RollNumberMatchResult;
}

export interface StockTemplateMarkerCheckResult {
  complete: boolean;
  /** Largest distance (px, 1 canvas px = 1 PDF point at this check's scale) between a detected marker's center and where `geometry.ts` says it should be — 0 in the noiseless case this check draws, so any real disagreement means the geometry/marker-pattern data itself is wrong, not measurement noise. */
  maxPositionErrorPx: number;
}

export interface SheetBoundaryCaseSpec {
  angleDeg?: number;
  corners?: [Point, Point, Point, Point];
  blank?: boolean;
}

export interface SheetBoundaryCaseResult {
  detected: boolean;
  /** Largest distance (px) between a detected corner and its ground-truth counterpart, after ordering both the same way (topLeft/topRight/bottomRight/bottomLeft) — `null` when nothing was detected at all. */
  maxCornerErrorPx: number | null;
  method: 'polygon' | 'bounding-rectangle' | null;
}

export interface BubbleGridCaseSpec {
  rows: number;
  columns: number;
}

export interface DetectionHarnessApi {
  cvReady: boolean;
  runCornerDetectionCase: (tiltDeg: number) => CornerDetectionCaseResult;
  runQuestionGridCase: (spec: QuestionGridCaseSpec) => QuestionGridCaseResult;
  runRollNumberCase: (spec: RollNumberCaseSpec) => RollNumberCaseResult;
  runStockTemplateMarkerCheck: (
    questionCount: StockTemplateQuestionCount,
  ) => StockTemplateMarkerCheckResult;
  runSheetBoundaryCase: (spec: SheetBoundaryCaseSpec) => SheetBoundaryCaseResult;
  runBubbleGridCase: (spec: BubbleGridCaseSpec) => EstimatedBubbleGrid;
}

declare global {
  interface Window {
    DetectionHarness: DetectionHarnessApi;
    cv?: unknown;
  }
}

const api: DetectionHarnessApi = {
  cvReady: false,

  runCornerDetectionCase(tiltDeg) {
    const cv = requireCv();
    const built = buildBubbleSheet(cv, []);
    const flatMat = sheetToMat(cv, built.canvas);
    const tilted = simulateTilt(
      cv,
      flatMat,
      built.flatCenters,
      tiltDeg,
      built.canvas.width,
      built.canvas.height,
    );
    flatMat.delete();

    const detector = new CornerMarkerDetector(cv as unknown as ArucoCv);
    const detection = detector.detect(tilted);
    tilted.delete();

    return { complete: detection.complete };
  },

  runQuestionGridCase(spec) {
    const { cornerDetectionComplete, results } = classifyGroups(spec.tiltDeg, spec.questions);
    return { cornerDetectionComplete, questions: results };
  },

  runRollNumberCase(spec) {
    const { cornerDetectionComplete, results } = classifyGroups(spec.tiltDeg, spec.columns);
    if (!cornerDetectionComplete) {
      return {
        cornerDetectionComplete: false,
        read: { status: 'unreadable' },
        match: { status: 'unread' },
      };
    }
    const read = readRollNumber(results);
    const match = matchRollNumber(read, new Set(spec.roster));
    return { cornerDetectionComplete: true, read, match };
  },

  runStockTemplateMarkerCheck(questionCount) {
    const cv = requireCv();
    const geometry = computeStockTemplateGeometry(questionCount);

    // 1 canvas px = 1 PDF point — the same top-left-origin, y-down space
    // geometry.ts already works in, so no coordinate flip is needed here
    // (unlike generate-pdf.ts, which flips into pdf-lib's y-up convention).
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(geometry.pageWidthPt);
    canvas.height = Math.ceil(geometry.pageHeightPt);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const corners: Array<[CornerName, { x: number; y: number }]> = Object.entries(
      geometry.markers,
    ) as Array<[CornerName, { x: number; y: number }]>;
    for (const [corner, center] of corners) {
      const grid = fullMarkerGrid(arucoDataGridForCorner(corner));
      const cellSize = geometry.markerSizePt / grid.length;
      const left = center.x - geometry.markerSizePt / 2;
      const top = center.y - geometry.markerSizePt / 2;
      ctx.fillStyle = 'black';
      for (let row = 0; row < grid.length; row++) {
        for (let col = 0; col < grid[row].length; col++) {
          if (grid[row][col] !== 1) continue;
          ctx.fillRect(left + col * cellSize, top + row * cellSize, cellSize, cellSize);
        }
      }
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const mat = (cv as unknown as ArucoCv).matFromImageData(imageData);
    const detector = new CornerMarkerDetector(cv as unknown as ArucoCv);
    const detection = detector.detect(mat);
    mat.delete();

    if (!detection.complete) {
      return { complete: false, maxPositionErrorPx: Number.POSITIVE_INFINITY };
    }

    let maxPositionErrorPx = 0;
    for (const [corner, expectedCenter] of corners) {
      const detected = detection.corners[corner].center;
      const error = Math.hypot(detected.x - expectedCenter.x, detected.y - expectedCenter.y);
      maxPositionErrorPx = Math.max(maxPositionErrorPx, error);
    }
    return { complete: true, maxPositionErrorPx };
  },

  runSheetBoundaryCase(spec) {
    const cv = requireCv();
    const { canvas, groundTruthCorners } = buildSyntheticSheetPhoto(spec);
    const mat = sheetToMat(cv, canvas);
    const result = detectSheetBoundary(cv as unknown as SheetBoundaryCv, mat);
    mat.delete();

    if (!result) return { detected: false, maxCornerErrorPx: null, method: null };

    const detected = [
      result.corners.topLeft,
      result.corners.topRight,
      result.corners.bottomRight,
      result.corners.bottomLeft,
    ];
    let maxCornerErrorPx = 0;
    for (let i = 0; i < 4; i++) {
      const error = Math.hypot(
        detected[i].x - groundTruthCorners[i].x,
        detected[i].y - groundTruthCorners[i].y,
      );
      maxCornerErrorPx = Math.max(maxCornerErrorPx, error);
    }
    return { detected: true, maxCornerErrorPx, method: result.method };
  },

  runBubbleGridCase(spec) {
    const cv = requireCv();
    const canvas = buildSyntheticBubbleGridPhoto(spec);
    const mat = sheetToMat(cv, canvas);
    const result = estimateBubbleGrid(cv as unknown as DetectBubbleGridCv, mat);
    mat.delete();
    return result;
  },
};

window.DetectionHarness = api;

/**
 * Returns `{ cv }`, never bare `cv` — same rule opencv-loader.ts's
 * `OpenCvHandle` doc comment establishes and warns about at length: the
 * emscripten Module object has its own `.then()`, so resolving an async
 * function/Promise directly with `cv` as the value makes the engine's
 * thenable-resolution check call that `.then()` to "unwrap" it, which
 * calls back with the same `cv` again — an infinite, self-referential
 * microtask loop that pins the main thread. Reproduced this exact bug
 * empirically while building this harness (every test timed out waiting
 * on `cvReady`, and a renderer process was found pegged at 100%+ CPU)
 * before wrapping the return value fixed it — see docs/reports/
 * SHARLO-M1-010.md.
 */
async function waitForCv(): Promise<{ cv: HarnessCv }> {
  const globalCv = window.cv;
  if (globalCv instanceof Promise) {
    const cv = (await globalCv) as HarnessCv;
    return { cv };
  }
  const cv = globalCv as HarnessCv & { onRuntimeInitialized?: () => void };
  await new Promise<void>((resolve) => {
    cv.onRuntimeInitialized = () => resolve();
  });
  return { cv };
}

waitForCv().then((handle) => {
  cvHandle = handle.cv;
  api.cvReady = true;
});

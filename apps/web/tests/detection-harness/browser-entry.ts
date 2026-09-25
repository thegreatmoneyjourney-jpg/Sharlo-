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

import type { ArucoCv, CornerName, CvMat, Point } from '../../lib/scanning/corner-markers';
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
import type { StockTemplateQuestionCount } from '../../lib/templates/geometry';
import { computeStockTemplateGeometry } from '../../lib/templates/geometry';
import type { SheetBoundaryCv } from '../../lib/templates/detect-sheet-boundary';
import { detectSheetBoundary } from '../../lib/templates/detect-sheet-boundary';
import type {
  DetectBubbleGridCv,
  EstimatedBubbleGrid,
} from '../../lib/templates/detect-bubble-grid';
import { estimateBubbleGrid } from '../../lib/templates/detect-bubble-grid';
import { mapTemplateGeometryToFrame } from '../../lib/templates/map-geometry-to-frame';
import { readAnswerSheet } from '../../lib/scanning/read-answer-sheet';
import { buildReviewItemSpecs } from '../../lib/scanning/review-queue';
import type { CropRect } from '../../lib/scanning/review-queue';
import { detectAndReadSheet } from '../../lib/scanning/read-sheet-from-image';
import { loadPdfDocument } from '../../lib/scanning/load-pdf-file';
import { generateTemplatePdf } from '../../lib/templates/generate-pdf';
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
import type { StockSheetAnswers } from './stock-sheet-fixtures';
import { buildStockSheetCanvas, drawStockMarkers } from './stock-sheet-fixtures';

/** See `buildStockSheetCanvas`'s own doc comment for why this needed to be found empirically, not assumed as 1. */
const STOCK_SHEET_RENDER_SCALE = 3;

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

export interface FullStockSheetReadCaseSpec {
  questionCount: StockTemplateQuestionCount;
  tiltDeg: number;
  answers: StockSheetAnswers;
}

export interface FullStockSheetReadCaseResult {
  cornerDetectionComplete: boolean;
  questions: QuestionResult[];
  rollNumberColumns: QuestionResult[];
}

export interface ContinuousScanStressCaseSpec {
  questionCount: StockTemplateQuestionCount;
  /** Number of distinct sheets to read in sequence within a single cv/page session — M2-005's "scan a full class of 30+ sheets back-to-back" done-when criterion, automated for everything downstream of a captured frame (see this case's own handler doc comment for what it does and doesn't cover). */
  sheetCount: number;
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
  runFullStockSheetReadCase: (spec: FullStockSheetReadCaseSpec) => FullStockSheetReadCaseResult;
  runContinuousScanStressCase: (
    spec: ContinuousScanStressCaseSpec,
  ) => FullStockSheetReadCaseResult[];
  runReviewCropCase: (spec: ReviewCropCaseSpec) => ReviewCropCaseResult;
  /**
   * M2-009: drives the real, production `detectAndReadSheet` (`lib/
   * scanning/read-sheet-from-image.ts`) directly — the exact function
   * `use-sheet-reader.ts` (via `readSheetFromCorners`) and the batch-import
   * loop (`exam-scan-flow.tsx`) both call — against a tilted, rasterized
   * sheet with no pre-known corners, standing in for an uploaded photo/
   * scan. Deliberately NOT routed through this file's own
   * `detectDewarpAndRead`/`readOneStockSheet`: those predate this task and
   * are already proven by `runFullStockSheetReadCase`/
   * `runContinuousScanStressCase`/`runReviewCropCase`; this case exists
   * specifically to prove the *new*, separately-extracted function
   * produces the same correct result end-to-end in a real browser, not to
   * re-verify logic those cases already cover.
   */
  runDetectAndReadSheetCase: (spec: FullStockSheetReadCaseSpec) => FullStockSheetReadCaseResult;
  /**
   * M2-009: proves `lib/scanning/load-pdf-file.ts`'s real pdfjs-dist
   * rendering (worker load, page render, viewport scaling) is wired up
   * correctly in a real browser — the one thing here jsdom cannot
   * exercise at all — and that its output is directly compatible with the
   * real `detectAndReadSheet`. Renders the actual printable stock
   * template PDF `generateTemplatePdf` (M2-001) produces, the same file a
   * teacher prints, fills in, and re-scans; since this harness renders it
   * unfilled, every bubble reading back `blank` is the correct, expected
   * result, not a failure — the meaningful assertion is that corner
   * detection completes and every question/roll-number group is read at
   * all, proving the rendered pixels are clean and correctly scaled.
   */
  runPdfRenderCase: (spec: PdfRenderCaseSpec) => Promise<PdfRenderCaseResult>;
}

export interface ReviewCropCaseSpec {
  questionCount: StockTemplateQuestionCount;
  answers: StockSheetAnswers;
}

export interface ReviewCropResult {
  kind: 'question' | 'roll-number';
  questionNumber?: number;
  width: number;
  height: number;
  /** `data:image/png;base64,` prefix plus non-trivial length — proof the real canvas drawImage+toDataURL extraction (M2-006's use-sheet-reader.ts) actually produced a real image from real dewarped pixels, not an empty/broken canvas. jsdom can't exercise this at all (no real Canvas 2D implementation), so this is the one thing only a real-browser pass like this can prove. */
  isValidPngDataUrl: boolean;
}

export interface ReviewCropCaseResult {
  cornerDetectionComplete: boolean;
  crops: ReviewCropResult[];
}

export interface PdfRenderCaseSpec {
  questionCount: StockTemplateQuestionCount;
}

export interface PdfRenderCaseResult {
  numPages: number;
  pageWidth: number;
  pageHeight: number;
  cornerDetectionComplete: boolean;
  /** Every question/roll-number digit should read back `blank` — this renders the *unfilled* printable template PDF (`generateTemplatePdf`, M2-001) real bubble sheets are printed from, not a filled-in one, so "blank" here is the correct, expected outcome, not a failure. */
  questions: QuestionResult[];
  rollNumberColumns: QuestionResult[];
}

declare global {
  interface Window {
    DetectionHarness: DetectionHarnessApi;
    cv?: unknown;
  }
}

interface DewarpAndReadOutcome {
  cornerDetectionComplete: boolean;
  dewarpedCanvas: HTMLCanvasElement | null;
  mappedGeometry: ReturnType<typeof mapTemplateGeometryToFrame> | null;
  result: ReturnType<typeof readAnswerSheet> | null;
}

/**
 * The single-sheet detect -> dewarp -> map -> read pipeline, factored out
 * so every case that needs it (`runFullStockSheetReadCase`,
 * `runContinuousScanStressCase` (M2-005), `runReviewCropCase` (M2-006))
 * calls the exact same code path rather than a second, drifting copy of
 * it. Keeps the dewarped canvas itself in the result (not just the
 * classification) since M2-006's crop generation needs real pixels to
 * crop from, the same way `use-sheet-reader.ts` reuses its own dewarped
 * canvas rather than dewarping a second time.
 */
function detectDewarpAndRead(
  cv: HarnessCv,
  geometry: ReturnType<typeof computeStockTemplateGeometry>,
  answers: StockSheetAnswers,
  tiltDeg: number,
): DewarpAndReadOutcome {
  const { canvas, scaledMarkers } = buildStockSheetCanvas(
    geometry,
    answers,
    STOCK_SHEET_RENDER_SCALE,
  );

  const flatMat = sheetToMat(cv, canvas);
  const tilted = simulateTilt(cv, flatMat, scaledMarkers, tiltDeg, canvas.width, canvas.height);
  flatMat.delete();

  const detector = new CornerMarkerDetector(cv as unknown as ArucoCv);
  const detection = detector.detect(tilted);
  if (!detection.complete) {
    tilted.delete();
    return {
      cornerDetectionComplete: false,
      dewarpedCanvas: null,
      mappedGeometry: null,
      result: null,
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

  const mappedGeometry = mapTemplateGeometryToFrame(
    geometry,
    { width: dewarped.width, height: dewarped.height },
    DEFAULT_PADDING_RATIO,
  );
  const result = readAnswerSheet(dewarpedImageData, mappedGeometry);

  return { cornerDetectionComplete: true, dewarpedCanvas, mappedGeometry, result };
}

function readOneStockSheet(
  cv: HarnessCv,
  geometry: ReturnType<typeof computeStockTemplateGeometry>,
  answers: StockSheetAnswers,
  tiltDeg: number,
): FullStockSheetReadCaseResult {
  const outcome = detectDewarpAndRead(cv, geometry, answers, tiltDeg);
  if (!outcome.cornerDetectionComplete || !outcome.result) {
    return { cornerDetectionComplete: false, questions: [], rollNumberColumns: [] };
  }
  return {
    cornerDetectionComplete: true,
    questions: outcome.result.questions,
    rollNumberColumns: outcome.result.rollNumberColumns,
  };
}

/** Same drawImage+toDataURL extraction `use-sheet-reader.ts`'s own `cropToDataUrl` performs — reimplemented here rather than imported, since that file is a 'use client' React hook pulling in browser-lifecycle imports (opencv-loader.ts's script-injection loader) this harness's own separate cv-bootstrapping shouldn't be bundled alongside; only the pure, DOM-free `CropRect` type and `buildReviewItemSpecs` function are actually shared (imported above). */
function cropRegionToDataUrl(source: HTMLCanvasElement, rect: CropRect): string {
  const crop = document.createElement('canvas');
  crop.width = Math.max(1, Math.round(rect.width));
  crop.height = Math.max(1, Math.round(rect.height));
  const ctx = crop.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(
    source,
    rect.left,
    rect.top,
    rect.width,
    rect.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  return crop.toDataURL('image/png');
}

/** `cv.imshow` + `getImageData` — the one conversion every case here that needs to hand a *raw, pre-dewarp* Mat to a real ImageData-consuming function repeats inline (see `detectDewarpAndRead`'s own dewarped-side copy of this), pulled out once for `runDetectAndReadSheetCase` since unlike those, its input Mat is the tilted capture itself, not a dewarped result. */
function matToImageData(cv: HarnessCv, mat: CvMat): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = (mat as unknown as { cols: number }).cols;
  canvas.height = (mat as unknown as { rows: number }).rows;
  cv.imshow(canvas, mat);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * A different, fully-determined answer pattern per sheet index — a real
 * continuous session never reads the identical sheet twice in a row, so
 * `runContinuousScanStressCase` shouldn't either. Deterministic (not
 * random) so a failure at sheet N is exactly reproducible.
 */
function answersForStressIndex(questionCount: number, index: number): StockSheetAnswers {
  return {
    questionAnswers: Array.from({ length: questionCount }, (_, q) => (q + index) % 4),
    rollNumberDigits: Array.from({ length: 6 }, (_, d) => (d + index) % 10),
  };
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
    drawStockMarkers(ctx, geometry);

    const corners: Array<[CornerName, { x: number; y: number }]> = Object.entries(
      geometry.markers,
    ) as Array<[CornerName, { x: number; y: number }]>;

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

  runFullStockSheetReadCase(spec) {
    const cv = requireCv();
    const geometry = computeStockTemplateGeometry(spec.questionCount);
    return readOneStockSheet(cv, geometry, spec.answers, spec.tiltDeg);
  },

  runContinuousScanStressCase(spec) {
    const cv = requireCv();
    const geometry = computeStockTemplateGeometry(spec.questionCount);
    const results: FullStockSheetReadCaseResult[] = [];
    for (let i = 0; i < spec.sheetCount; i++) {
      results.push(
        readOneStockSheet(cv, geometry, answersForStressIndex(spec.questionCount, i), 0),
      );
    }
    return results;
  },

  runReviewCropCase(spec) {
    const cv = requireCv();
    const geometry = computeStockTemplateGeometry(spec.questionCount);
    const outcome = detectDewarpAndRead(cv, geometry, spec.answers, 0);
    if (
      !outcome.cornerDetectionComplete ||
      !outcome.result ||
      !outcome.mappedGeometry ||
      !outcome.dewarpedCanvas
    ) {
      return { cornerDetectionComplete: false, crops: [] };
    }

    const rollRead = readRollNumber(outcome.result.rollNumberColumns);
    const frameSize = {
      width: outcome.dewarpedCanvas.width,
      height: outcome.dewarpedCanvas.height,
    };
    const specs = buildReviewItemSpecs(outcome.result, outcome.mappedGeometry, rollRead, frameSize);

    const crops: ReviewCropResult[] = specs.map((itemSpec) => {
      const dataUrl = cropRegionToDataUrl(outcome.dewarpedCanvas!, itemSpec.cropRect);
      return {
        kind: itemSpec.kind,
        questionNumber: itemSpec.kind === 'question' ? itemSpec.questionNumber : undefined,
        width: Math.round(itemSpec.cropRect.width),
        height: Math.round(itemSpec.cropRect.height),
        isValidPngDataUrl: dataUrl.startsWith('data:image/png;base64,') && dataUrl.length > 100,
      };
    });

    return { cornerDetectionComplete: true, crops };
  },

  runDetectAndReadSheetCase(spec) {
    const cv = requireCv();
    const geometry = computeStockTemplateGeometry(spec.questionCount);
    const { canvas, scaledMarkers } = buildStockSheetCanvas(
      geometry,
      spec.answers,
      STOCK_SHEET_RENDER_SCALE,
    );

    const flatMat = sheetToMat(cv, canvas);
    const tilted = simulateTilt(
      cv,
      flatMat,
      scaledMarkers,
      spec.tiltDeg,
      canvas.width,
      canvas.height,
    );
    flatMat.delete();

    const imageData = matToImageData(cv, tilted);
    tilted.delete();

    const detected = detectAndReadSheet(cv, imageData, geometry);
    if (detected.status === 'no-markers-detected') {
      return { cornerDetectionComplete: false, questions: [], rollNumberColumns: [] };
    }
    return {
      cornerDetectionComplete: true,
      questions: detected.outcome.result.questions,
      rollNumberColumns: detected.outcome.result.rollNumberColumns,
    };
  },

  async runPdfRenderCase(spec) {
    const cv = requireCv();
    const geometry = computeStockTemplateGeometry(spec.questionCount);

    const pdfBytes = await generateTemplatePdf(geometry);
    const file = new File([new Uint8Array(pdfBytes)], 'stock-template.pdf', {
      type: 'application/pdf',
    });

    const doc = await loadPdfDocument(file);
    const page = await doc.loadPage(1);

    const detected = detectAndReadSheet(cv, page.imageData, geometry);
    if (detected.status === 'no-markers-detected') {
      return {
        numPages: doc.numPages,
        pageWidth: page.width,
        pageHeight: page.height,
        cornerDetectionComplete: false,
        questions: [],
        rollNumberColumns: [],
      };
    }
    return {
      numPages: doc.numPages,
      pageWidth: page.width,
      pageHeight: page.height,
      cornerDetectionComplete: true,
      questions: detected.outcome.result.questions,
      rollNumberColumns: detected.outcome.result.rollNumberColumns,
    };
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

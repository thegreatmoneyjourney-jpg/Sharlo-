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

import type { ArucoCv } from '../../lib/scanning/corner-markers';
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
import type { HarnessCv } from './fixtures';
import {
  SAMPLE_RADIUS_PX,
  buildBubbleSheet,
  destRectFor,
  expectedDewarpedPoint,
  sheetToMat,
  simulateTilt,
} from './fixtures';

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

export interface DetectionHarnessApi {
  cvReady: boolean;
  runCornerDetectionCase: (tiltDeg: number) => CornerDetectionCaseResult;
  runQuestionGridCase: (spec: QuestionGridCaseSpec) => QuestionGridCaseResult;
  runRollNumberCase: (spec: RollNumberCaseSpec) => RollNumberCaseResult;
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

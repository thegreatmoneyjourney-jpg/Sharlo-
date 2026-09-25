/**
 * Detection-engine test harness (M1-010, NFR-ACC-01–04) — runs the real
 * M1-003 through M1-009 pipeline (ArUco corner detection → perspective
 * dewarp → bubble-fill sampling/classification → roll-number reading),
 * driven by real rendered pixels on real OpenCV WASM in a real headless
 * Chromium, against a checked-in, deterministically-generated fixture
 * set (`fixtures.ts`). This is the gap each module's own unit tests
 * (mocked `cv`, or hand-typed `ImageData` arrays) explicitly document as
 * out of scope for themselves — see the "Flags" section of
 * docs/reports/SHARLO-M1-010.md for what this fixture set can and can't
 * establish given it's synthetic, not real printed/scanned sheets.
 *
 * Every expected outcome below is written out explicitly in the test
 * that asserts it — never derived automatically from the same numbers
 * used to draw a fixture — so a bug in the fixture-drawing/expected-value
 * math can't quietly validate itself.
 */
import { expect, test, type Page } from '@playwright/test';
import type { DetectionHarnessApi } from './browser-entry';

declare global {
  interface Window {
    DetectionHarness: DetectionHarnessApi;
  }
}

async function gotoHarness(page: Page): Promise<void> {
  await page.goto('/harness.html');
  await page.waitForFunction(() => window.DetectionHarness?.cvReady === true, undefined, {
    timeout: 20_000,
  });
}

test.describe('corner marker detection across tilt (NFR-ACC-01: ≤15° tilt)', () => {
  test('detects all 4 markers at 0°, 5°, 10°, and 15° tilt', async ({ page }) => {
    await gotoHarness(page);

    for (const tiltDeg of [0, 5, 10, 15]) {
      await test.step(`${tiltDeg}° tilt`, async () => {
        const result = await page.evaluate(
          (angle) => window.DetectionHarness.runCornerDetectionCase(angle),
          tiltDeg,
        );
        expect(result.complete).toBe(true);
      });
    }
  });
});

test.describe('full pipeline: confidently-answered questions (NFR-ACC-02)', () => {
  for (const tiltDeg of [0, 10]) {
    test(`a single confidently-filled option per question is read correctly at ${tiltDeg}° tilt`, async ({
      page,
    }) => {
      await gotoHarness(page);

      // 5 questions, 4 options each, a different correct option per
      // question — proves the pipeline reads the actual marked option,
      // not just always the first/last one.
      const correctOptions = [0, 1, 2, 3, 0];
      const questions = correctOptions.map((correctIndex) =>
        Array.from({ length: 4 }, (_, optionIndex) => (optionIndex === correctIndex ? 1 : 0)),
      );

      const result = await page.evaluate(
        (spec) => window.DetectionHarness.runQuestionGridCase(spec),
        { tiltDeg, questions },
      );

      expect(result.cornerDetectionComplete).toBe(true);
      expect(result.questions).toEqual(
        correctOptions.map((optionIndex) => ({ outcome: 'answered', optionIndex })),
      );
    });
  }

  test('a question with every option empty reads as blank, not guessed', async ({ page }) => {
    await gotoHarness(page);

    const result = await page.evaluate(
      (spec) => window.DetectionHarness.runQuestionGridCase(spec),
      { tiltDeg: 0, questions: [[0, 0, 0, 0]] },
    );

    expect(result.cornerDetectionComplete).toBe(true);
    expect(result.questions).toEqual([{ outcome: 'blank' }]);
  });
});

test.describe('never silently misreads an ambiguous mark (NFR-ACC-03, FR-DETECT-03)', () => {
  test('a uniformly faint partial fill is flagged, never read as blank or filled', async ({
    page,
  }) => {
    await gotoHarness(page);

    const result = await page.evaluate(
      (spec) => window.DetectionHarness.runQuestionGridCase(spec),
      { tiltDeg: 0, questions: [[0.3, 0, 0, 0]] },
    );

    expect(result.cornerDetectionComplete).toBe(true);
    expect(result.questions).toEqual([{ outcome: 'flagged' }]);
  });

  test('two confidently-filled options in one question (multiple marks) is flagged, never a guessed pick', async ({
    page,
  }) => {
    await gotoHarness(page);

    const result = await page.evaluate(
      (spec) => window.DetectionHarness.runQuestionGridCase(spec),
      { tiltDeg: 0, questions: [[1, 1, 0, 0]] },
    );

    expect(result.cornerDetectionComplete).toBe(true);
    expect(result.questions).toEqual([{ outcome: 'flagged' }]);
  });

  test('several simultaneously-ambiguous options in one question is flagged', async ({ page }) => {
    await gotoHarness(page);

    const result = await page.evaluate(
      (spec) => window.DetectionHarness.runQuestionGridCase(spec),
      { tiltDeg: 0, questions: [[0.25, 0.35, 0, 0]] },
    );

    expect(result.cornerDetectionComplete).toBe(true);
    expect(result.questions).toEqual([{ outcome: 'flagged' }]);
  });

  test('one ambiguous question does not affect an unrelated confidently-answered question on the same sheet', async ({
    page,
  }) => {
    await gotoHarness(page);

    const result = await page.evaluate(
      (spec) => window.DetectionHarness.runQuestionGridCase(spec),
      {
        tiltDeg: 0,
        questions: [
          [0, 1, 0, 0], // confidently answered, option 1
          [0.3, 0, 0, 0], // ambiguous
          [0, 0, 0, 1], // confidently answered, option 3
        ],
      },
    );

    expect(result.cornerDetectionComplete).toBe(true);
    expect(result.questions).toEqual([
      { outcome: 'answered', optionIndex: 1 },
      { outcome: 'flagged' },
      { outcome: 'answered', optionIndex: 3 },
    ]);
  });
});

test.describe('roll-number grid reading (FR-DETECT-04)', () => {
  test('a confidently-marked roll number matching the roster is matched', async ({ page }) => {
    await gotoHarness(page);

    const digitColumn = (digit: number) =>
      Array.from({ length: 10 }, (_, optionIndex) => (optionIndex === digit ? 1 : 0));

    const result = await page.evaluate((spec) => window.DetectionHarness.runRollNumberCase(spec), {
      tiltDeg: 0,
      columns: [digitColumn(4), digitColumn(0), digitColumn(7)],
      roster: ['407', '045', '123'],
    });

    expect(result.cornerDetectionComplete).toBe(true);
    expect(result.read).toEqual({ status: 'read', value: '407' });
    expect(result.match).toEqual({ status: 'matched', rollNumber: '407' });
  });

  test('a confidently-read roll number absent from the roster is routed to unmatched, not silently dropped', async ({
    page,
  }) => {
    await gotoHarness(page);

    const digitColumn = (digit: number) =>
      Array.from({ length: 10 }, (_, optionIndex) => (optionIndex === digit ? 1 : 0));

    const result = await page.evaluate((spec) => window.DetectionHarness.runRollNumberCase(spec), {
      tiltDeg: 0,
      columns: [digitColumn(9), digitColumn(9), digitColumn(9)],
      roster: ['407', '045', '123'],
    });

    expect(result.cornerDetectionComplete).toBe(true);
    expect(result.read).toEqual({ status: 'read', value: '999' });
    expect(result.match).toEqual({ status: 'unmatched', rollNumber: '999' });
  });

  test('a roll number with one blank digit column is unreadable, routed to unread rather than a partial guess', async ({
    page,
  }) => {
    await gotoHarness(page);

    const digitColumn = (digit: number) =>
      Array.from({ length: 10 }, (_, optionIndex) => (optionIndex === digit ? 1 : 0));

    const result = await page.evaluate((spec) => window.DetectionHarness.runRollNumberCase(spec), {
      tiltDeg: 0,
      columns: [digitColumn(4), Array(10).fill(0), digitColumn(7)],
      roster: ['407', '045', '123'],
    });

    expect(result.cornerDetectionComplete).toBe(true);
    expect(result.read).toEqual({ status: 'unreadable' });
    expect(result.match).toEqual({ status: 'unread' });
  });
});

test.describe('stock template corner markers are actually detectable (M2-001, FR-TPL-01)', () => {
  test('all 4 corner markers on every stock question-count variant detect at their exact geometry.ts positions', async ({
    page,
  }) => {
    await gotoHarness(page);

    for (const questionCount of [20, 50, 100] as const) {
      await test.step(`${questionCount}-question variant`, async () => {
        const result = await page.evaluate(
          (count) => window.DetectionHarness.runStockTemplateMarkerCheck(count),
          questionCount,
        );

        expect(result.complete).toBe(true);
        // Sub-pixel refinement (CORNER_REFINE_SUBPIX) means this is never
        // exactly 0 even on a noiseless render — a few px is detection
        // precision, not a geometry bug; a real position-math error would
        // show up as many pixels or points off, not this small.
        expect(result.maxPositionErrorPx).toBeLessThan(3);
      });
    }
  });
});

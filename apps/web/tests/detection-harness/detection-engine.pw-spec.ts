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

test.describe('custom-template sheet boundary detection (M2-003, FR-TPL-02)', () => {
  test('detects a straight, untilted sheet precisely', async ({ page }) => {
    await gotoHarness(page);
    const result = await page.evaluate(
      (spec) => window.DetectionHarness.runSheetBoundaryCase(spec),
      { angleDeg: 0 },
    );
    expect(result.detected).toBe(true);
    expect(result.method).toBe('polygon');
    expect(result.maxCornerErrorPx).toBeLessThan(5);
  });

  test('detects a rotated sheet precisely (Otsu threshold, not Canny — see detect-sheet-boundary.ts)', async ({
    page,
  }) => {
    await gotoHarness(page);
    const result = await page.evaluate(
      (spec) => window.DetectionHarness.runSheetBoundaryCase(spec),
      { angleDeg: 12 },
    );
    expect(result.detected).toBe(true);
    expect(result.method).toBe('polygon');
    expect(result.maxCornerErrorPx).toBeLessThan(8);
  });

  test('detects a genuine perspective trapezoid precisely (approxPolyDP, not minAreaRect)', async ({
    page,
  }) => {
    await gotoHarness(page);
    const result = await page.evaluate(
      (spec) => window.DetectionHarness.runSheetBoundaryCase(spec),
      {
        corners: [
          { x: 130, y: 40 },
          { x: 290, y: 55 },
          { x: 310, y: 270 },
          { x: 80, y: 260 },
        ] as [
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
        ],
      },
    );
    expect(result.detected).toBe(true);
    expect(result.method).toBe('polygon');
    // minAreaRect would force a rectangular fit here and land ~40px off
    // (measured in the scratchpad probe that validated this algorithm
    // choice) — a tight bound proves the real shipped module is still
    // using approxPolyDP's shape-hugging result, not silently falling
    // back to the rectangle-only path.
    expect(result.maxCornerErrorPx).toBeLessThan(8);
  });

  test('reports no detection (never a garbage guess) on a blank, featureless image', async ({
    page,
  }) => {
    await gotoHarness(page);
    const result = await page.evaluate(() =>
      window.DetectionHarness.runSheetBoundaryCase({ blank: true }),
    );
    // A uniform-color image has no Otsu-separable contour at all — the
    // real "nothing found" path, exercised end to end through the real
    // shipped module against a real (if trivial) image, not just
    // detectSheetBoundary.test.ts's unit-tested area-fraction guard.
    expect(result.detected).toBe(false);
    expect(result.maxCornerErrorPx).toBeNull();
  });
});

test.describe('custom-template bubble-grid estimation (M2-003, FR-TPL-02)', () => {
  test('recovers a clean uniform grid confidently', async ({ page }) => {
    await gotoHarness(page);
    const result = await page.evaluate((spec) => window.DetectionHarness.runBubbleGridCase(spec), {
      rows: 6,
      columns: 4,
    });
    expect(result).toEqual({ rows: 6, columns: 4, confident: true });
  });

  test('recovers a larger, denser grid confidently', async ({ page }) => {
    await gotoHarness(page);
    const result = await page.evaluate((spec) => window.DetectionHarness.runBubbleGridCase(spec), {
      rows: 20,
      columns: 4,
    });
    expect(result).toEqual({ rows: 20, columns: 4, confident: true });
  });

  test('recovers a dense, narrow grid confidently', async ({ page }) => {
    await gotoHarness(page);
    const result = await page.evaluate((spec) => window.DetectionHarness.runBubbleGridCase(spec), {
      rows: 25,
      columns: 2,
    });
    expect(result).toEqual({ rows: 25, columns: 2, confident: true });
  });
});

test.describe('full stock-sheet read (M2-004, FR-EXAM-03): map-geometry-to-frame.ts + read-answer-sheet.ts against real pixels', () => {
  const cyclingAnswers = Array.from({ length: 20 }, (_, i) => i % 4);
  const rollDigits = [4, 0, 7, 1, 2, 3];

  test('reads every question and roll-number digit correctly at 0° tilt', async ({ page }) => {
    await gotoHarness(page);

    const result = await page.evaluate(
      (spec) => window.DetectionHarness.runFullStockSheetReadCase(spec),
      {
        questionCount: 20 as const,
        tiltDeg: 0,
        answers: { questionAnswers: cyclingAnswers, rollNumberDigits: rollDigits },
      },
    );

    expect(result.cornerDetectionComplete).toBe(true);
    expect(result.questions).toEqual(
      cyclingAnswers.map((optionIndex) => ({ outcome: 'answered', optionIndex })),
    );
    expect(result.rollNumberColumns).toEqual(
      rollDigits.map((optionIndex) => ({ outcome: 'answered', optionIndex })),
    );
  });

  test('reads correctly after a real detected-and-dewarped tilt (10°) — proves map-geometry-to-frame.ts works on more than a flat/untilted frame', async ({
    page,
  }) => {
    await gotoHarness(page);

    const result = await page.evaluate(
      (spec) => window.DetectionHarness.runFullStockSheetReadCase(spec),
      {
        questionCount: 20 as const,
        tiltDeg: 10,
        answers: { questionAnswers: cyclingAnswers, rollNumberDigits: rollDigits },
      },
    );

    expect(result.cornerDetectionComplete).toBe(true);
    expect(result.questions).toEqual(
      cyclingAnswers.map((optionIndex) => ({ outcome: 'answered', optionIndex })),
    );
    expect(result.rollNumberColumns).toEqual(
      rollDigits.map((optionIndex) => ({ outcome: 'answered', optionIndex })),
    );
  });

  test('reads a left-blank question and a left-blank roll-number column as blank, never guessed', async ({
    page,
  }) => {
    await gotoHarness(page);

    const questionAnswers: (number | null)[] = new Array(20).fill(0);
    questionAnswers[4] = null; // question 5 left blank
    const rollNumberDigits: (number | null)[] = [4, 0, null, 1, 2, 3]; // column index 2 left blank

    const result = await page.evaluate(
      (spec) => window.DetectionHarness.runFullStockSheetReadCase(spec),
      { questionCount: 20 as const, tiltDeg: 0, answers: { questionAnswers, rollNumberDigits } },
    );

    expect(result.cornerDetectionComplete).toBe(true);
    expect(result.questions).toEqual(
      questionAnswers.map((a) =>
        a === null ? { outcome: 'blank' } : { outcome: 'answered', optionIndex: a },
      ),
    );
    expect(result.rollNumberColumns).toEqual(
      rollNumberDigits.map((d) =>
        d === null ? { outcome: 'blank' } : { outcome: 'answered', optionIndex: d },
      ),
    );
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

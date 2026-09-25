import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamScanFlow } from './exam-scan-flow';
import { computeStockTemplateGeometry } from '@/lib/templates/geometry';
import { readRollNumber } from '@/lib/scanning/roll-number';
import type { CameraState } from '../../scan/use-camera-stream';
import type { CapturedFrame } from '../../scan/capture-video-frame';
import type { QuestionResult } from '@/lib/scanning/bubble-fill';
import type { ReviewCropItem, SheetReadOutcome } from './use-sheet-reader';

/**
 * `ExamScanFlow` composes the exact same OpenCV/camera hooks
 * `scan-client.test.tsx` already mocks for the same reason (real ArUco
 * detection needs real browser WASM execution — see
 * docs/reports/SHARLO-M1-003.md) plus this task's own new
 * `useSheetReader`. This file proves step transitions and score
 * computation given controlled hook outputs; the real detection/read
 * pipeline is proven separately against real pixels (the M1-010
 * detection harness, extended this task) and the real camera/UI wiring
 * is proven against a real dev server with Chromium's fake-camera-device
 * flags (see docs/reports/SHARLO-M2-004.md's "How tested" section).
 */
const {
  loadOpenCvMock,
  useCameraStreamMock,
  useCornerDetectionMock,
  useAutoCaptureMock,
  useManualCaptureMock,
  useSheetReaderMock,
  loadImageFileMock,
  detectAndReadSheetMock,
  loadPdfDocumentMock,
} = vi.hoisted(() => ({
  loadOpenCvMock: vi.fn(),
  useCameraStreamMock: vi.fn(),
  useCornerDetectionMock: vi.fn(),
  useAutoCaptureMock: vi.fn(),
  useManualCaptureMock: vi.fn(),
  useSheetReaderMock: vi.fn(),
  loadImageFileMock: vi.fn(),
  detectAndReadSheetMock: vi.fn(),
  loadPdfDocumentMock: vi.fn(),
}));

vi.mock('@/lib/scanning/opencv-loader', () => ({ loadOpenCv: loadOpenCvMock }));
vi.mock('../../scan/use-camera-stream', () => ({ useCameraStream: useCameraStreamMock }));
vi.mock('../../scan/use-corner-detection', () => ({ useCornerDetection: useCornerDetectionMock }));
vi.mock('../../scan/use-auto-capture', () => ({ useAutoCapture: useAutoCaptureMock }));
vi.mock('../../scan/use-manual-capture', () => ({ useManualCapture: useManualCaptureMock }));
vi.mock('./use-sheet-reader', () => ({ useSheetReader: useSheetReaderMock }));
// The batch-import path (M2-009) doesn't go through `useSheetReader` at
// all — it calls these directly (see exam-scan-flow.tsx) since a batch
// item has no live per-frame detection loop to have already found its
// corners. Mocked for the same reason as everything else here: real
// image decoding/ArUco detection needs real browser/WASM execution,
// proven separately by the Playwright detection harness, not this file.
vi.mock('@/lib/scanning/load-image-file', () => ({ loadImageFile: loadImageFileMock }));
vi.mock('@/lib/scanning/read-sheet-from-image', () => ({
  detectAndReadSheet: detectAndReadSheetMock,
}));
vi.mock('@/lib/scanning/load-pdf-file', () => ({ loadPdfDocument: loadPdfDocumentMock }));

const OPENCV_READY = Promise.resolve({ cv: { getBuildInformation: () => 'x' } });
const GEOMETRY = computeStockTemplateGeometry(20);

function mockCamera(state: CameraState) {
  useCameraStreamMock.mockReturnValue({ state, retry: vi.fn() });
}

function fakeFrame(capturedAt: number): CapturedFrame {
  return {
    imageData: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
    corners: {},
    capturedAt,
  } as unknown as CapturedFrame;
}

/** Builds the shape the real useSheetReader produces, deriving `rollRead` from `rollNumberColumns` via the real readRollNumber rather than hand-typing a value that could drift out of sync with it. */
function readOutcome(
  questions: QuestionResult[],
  rollNumberColumns: QuestionResult[] = [{ outcome: 'answered', optionIndex: 4 }],
  reviewCrops: ReviewCropItem[] = [],
): SheetReadOutcome {
  return {
    result: { questions, rollNumberColumns },
    rollRead: readRollNumber(rollNumberColumns),
    reviewCrops,
  };
}

function allAnswered(count: number, optionIndex = 0): SheetReadOutcome {
  return readOutcome(
    Array.from({ length: count }, () => ({ outcome: 'answered' as const, optionIndex })),
  );
}

function fakeImageFile(name: string): File {
  return new File([], name, { type: 'image/jpeg' });
}

beforeEach(() => {
  mockCamera({ status: 'live' });
  loadOpenCvMock.mockReturnValue(OPENCV_READY);
  useCornerDetectionMock.mockReturnValue({ result: null, measuredFps: null });
  useAutoCaptureMock.mockReturnValue({
    status: 'searching',
    progress: 0,
    capturedFrame: null,
    onFrame: vi.fn(),
  });
  useManualCaptureMock.mockReturnValue({
    capturedFrame: null,
    canCapture: false,
    capture: vi.fn(),
  });
  useSheetReaderMock.mockReturnValue(null);
  loadImageFileMock.mockResolvedValue({
    imageUrl: 'data:image/jpeg;base64,FAKE',
    width: 2,
    height: 2,
    imageData: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
  });
});

afterEach(() => {
  cleanup();
  loadOpenCvMock.mockReset();
  useCameraStreamMock.mockReset();
  useCornerDetectionMock.mockReset();
  useAutoCaptureMock.mockReset();
  useManualCaptureMock.mockReset();
  useSheetReaderMock.mockReset();
  loadImageFileMock.mockReset();
  detectAndReadSheetMock.mockReset();
  loadPdfDocumentMock.mockReset();
});

describe('ExamScanFlow', () => {
  it('shows a loading indicator until OpenCV and the camera are both ready', () => {
    loadOpenCvMock.mockReturnValue(new Promise(() => {}));
    render(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading scanner/i);
  });

  it('shows a camera error with a working retry button', async () => {
    const retry = vi.fn();
    useCameraStreamMock.mockReturnValue({
      state: { status: 'error', reason: 'permission-denied' },
      retry,
    });
    render(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t start the camera/i);
    screen.getByRole('button', { name: /try again/i }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('starts in capture-key mode, prompting to scan the answer key', async () => {
    render(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);
    expect(await screen.findByText(/scan the answer key sheet first/i)).toBeInTheDocument();
  });

  it('shows an error and stays in capture-key mode when the key sheet has an unresolved question', async () => {
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome([{ outcome: 'answered', optionIndex: 0 }, { outcome: 'flagged' }], []),
    );

    render(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/question 2/i);
    expect(alert).toHaveTextContent(/scan again/i);
    expect(screen.getByText(/scan the answer key sheet first/i)).toBeInTheDocument();
  });

  it('accepts a fully-answered key and switches to scan-students mode', async () => {
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20));

    render(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

    expect(await screen.findByText(/key captured/i)).toBeInTheDocument();
    // No student sheet scanned yet — nothing to report on, so neither
    // "Review Needed" nor a vacuously-true "Fully graded" should show.
    expect(screen.queryByRole('button', { name: /review needed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fully graded/i })).not.toBeInTheDocument();
  });

  it('scores a subsequent capture against the key and shows the result', async () => {
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20, 0)); // key: every question = option 0

    const { rerender } = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/key captured/i);

    // A new capture: 18 match the key (option 0), 2 are wrong (option 1).
    const studentAnswers = Array.from({ length: 20 }, (_, i) => ({
      outcome: 'answered' as const,
      optionIndex: i < 18 ? 0 : 1,
    }));
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(2000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(studentAnswers, [{ outcome: 'answered', optionIndex: 7 }]),
    );

    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

    expect(await screen.findByText('18 / 20')).toBeInTheDocument();
    expect(screen.getByText(/roll #7/i)).toBeInTheDocument();
  });

  it('adds a flagged question to the Review Needed queue, and picking the correct answer resolves it and updates the score (M2-006)', async () => {
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20, 0)); // key: every question = option 0

    const { rerender } = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/key captured/i);

    // Student sheet: question 3 (index 2) flagged, every other question matches the key.
    const studentQuestions: QuestionResult[] = Array.from({ length: 20 }, (_, i) =>
      i === 2 ? { outcome: 'flagged' } : { outcome: 'answered', optionIndex: 0 },
    );
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(2000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(
        studentQuestions,
        [{ outcome: 'answered', optionIndex: 5 }],
        [{ kind: 'question', questionNumber: 3, cropDataUrl: 'data:image/png;base64,FAKE' }],
      ),
    );

    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

    const toggle = await screen.findByRole('button', { name: /review needed \(1\)/i });
    // Question 3 is pending review, not excluded — still counts in the denominator.
    expect(screen.getByText('19 / 20')).toBeInTheDocument();
    fireEvent.click(toggle);

    expect(screen.getByAltText(/question 3/i)).toBeInTheDocument();
    // Picking option A (index 0) matches the key's answer for question 3 -> correct.
    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    expect(await screen.findByRole('button', { name: /fully graded/i })).toBeInTheDocument();
    expect(screen.getByText('20 / 20')).toBeInTheDocument();
  });

  it('excluding a flagged question removes it from both the queue and the score denominator (M2-006)', async () => {
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20, 0));

    const { rerender } = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/key captured/i);

    const studentQuestions: QuestionResult[] = Array.from({ length: 20 }, (_, i) =>
      i === 6 ? { outcome: 'flagged' } : { outcome: 'answered', optionIndex: 0 },
    );
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(2000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(
        studentQuestions,
        [{ outcome: 'answered', optionIndex: 5 }],
        [{ kind: 'question', questionNumber: 7, cropDataUrl: 'data:image/png;base64,FAKE' }],
      ),
    );
    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: /review needed \(1\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /exclude/i }));

    // 19 questions actually count (the excluded one no longer appears in the denominator).
    expect(await screen.findByText('19 / 19')).toBeInTheDocument();
  });

  it("purges a review item's image after the retention window, but keeps the item resolvable (M2-007)", async () => {
    // Deliberately avoids vi.useFakeTimers(): mixing fake timers with
    // @testing-library's own setTimeout-based async polling (findBy*/
    // waitFor) is unreliable to get right and risks a flaky or hanging
    // test — exactly what CLAUDE.md's CI rules forbid papering over.
    // Instead, captures the interval callback exam-scan-flow.tsx
    // registers and invokes it directly with Date.now() mocked to
    // simulate real time having passed — proves the same wiring without
    // fighting the timer mechanism itself.
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20, 0));

    const { rerender } = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/key captured/i);

    const studentQuestions: QuestionResult[] = Array.from({ length: 20 }, (_, i) =>
      i === 3 ? { outcome: 'flagged' } : { outcome: 'answered', optionIndex: 0 },
    );
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(2000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(
        studentQuestions,
        [{ outcome: 'answered', optionIndex: 5 }],
        [{ kind: 'question', questionNumber: 4, cropDataUrl: 'data:image/png;base64,FAKE' }],
      ),
    );
    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: /review needed \(1\)/i }));
    expect(screen.getByAltText(/question 4/i)).toBeInTheDocument();

    const purgeCall = setIntervalSpy.mock.calls.find(([, ms]) => typeof ms === 'number');
    expect(purgeCall).toBeDefined();
    const purgeCallback = purgeCall![0] as () => void;

    const realNow = Date.now();
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 16 * 60 * 1000); // 16 min > the 15-min retention window
    act(() => {
      purgeCallback();
    });
    dateNowSpy.mockRestore();
    setIntervalSpy.mockRestore();

    // The image is gone, but the item and its resolve controls remain.
    expect(screen.queryByAltText(/question 4/i)).not.toBeInTheDocument();
    expect(screen.getByText(/image no longer available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /review needed \(1\)/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    expect(await screen.findByRole('button', { name: /fully graded/i })).toBeInTheDocument();
  });

  it('adds an unreadable roll number to the Review Needed queue, and typing the correct one resolves it (M2-006)', async () => {
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20, 0));

    const { rerender } = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/key captured/i);

    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(2000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(
        allAnswered(20, 0).result.questions,
        [{ outcome: 'blank' }],
        [{ kind: 'roll-number', cropDataUrl: 'data:image/png;base64,FAKE' }],
      ),
    );
    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

    expect(await screen.findByText(/roll number not read/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /review needed \(1\)/i }));

    const input = screen.getByLabelText(/correct roll number/i);
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('button', { name: /fully graded/i })).toBeInTheDocument();
    expect(screen.getByText(/roll #42/i)).toBeInTheDocument();
  });

  it('warns and holds the save when the same roll number is scanned twice, without saving it (M2-008)', async () => {
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20, 0));

    const { rerender } = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/key captured/i);

    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(2000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(allAnswered(20, 0).result.questions, [{ outcome: 'answered', optionIndex: 2 }]),
    );
    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);
    await screen.findByText('20 / 20');

    // A second capture reads the exact same roll number.
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(3000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(allAnswered(20, 1).result.questions, [{ outcome: 'answered', optionIndex: 2 }]),
    );
    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/roll #2/i);
    expect(dialog).toHaveTextContent(/already scanned/i);
    // Still showing the FIRST scan's result -- the second was never saved.
    expect(screen.getByText('20 / 20')).toBeInTheDocument();
  });

  it('Cancel discards the pending rescan, leaving the original result untouched (M2-008)', async () => {
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20, 0));

    const { rerender } = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/key captured/i);

    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(2000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(allAnswered(20, 0).result.questions, [{ outcome: 'answered', optionIndex: 3 }]),
    );
    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);
    await screen.findByText('20 / 20');

    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(3000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(allAnswered(20, 1).result.questions, [{ outcome: 'answered', optionIndex: 3 }]),
    );
    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('20 / 20')).toBeInTheDocument();
  });

  it('confirming "Rescan intentionally" replaces the prior entry, including dropping its orphaned review items (M2-008)', async () => {
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20, 0)); // key: every question = option 0

    const { rerender } = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/key captured/i);

    // First scan of roll #9: question 1 flagged (creates a review item).
    const firstScanQuestions: QuestionResult[] = Array.from({ length: 20 }, (_, i) =>
      i === 0 ? { outcome: 'flagged' } : { outcome: 'answered', optionIndex: 0 },
    );
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(2000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(
        firstScanQuestions,
        [{ outcome: 'answered', optionIndex: 9 }],
        [{ kind: 'question', questionNumber: 1, cropDataUrl: 'data:image/png;base64,FAKE' }],
      ),
    );
    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /review needed \(1\)/i })).toBeInTheDocument();

    // Second scan of the same roll #9: fully answered this time, no flags.
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(3000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(allAnswered(20, 0).result.questions, [{ outcome: 'answered', optionIndex: 9 }]),
    );
    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: /rescan intentionally/i }));

    // The old flagged-question review item is gone (it belonged to the
    // superseded scan), and the new, fully-clean scan's score is shown.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /fully graded/i })).toBeInTheDocument();
    expect(screen.getByText('20 / 20')).toBeInTheDocument();
  });

  it('a different roll number never triggers the duplicate prompt (M2-008)', async () => {
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20, 0));

    const { rerender } = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/key captured/i);

    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(2000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(allAnswered(20, 0).result.questions, [{ outcome: 'answered', optionIndex: 1 }]),
    );
    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);
    await screen.findByText(/roll #1/i);

    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(3000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(
      readOutcome(allAnswered(20, 0).result.questions, [{ outcome: 'answered', optionIndex: 2 }]),
    );
    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

    expect(await screen.findByText(/roll #2/i)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('scores 30 consecutive student captures correctly and independently, with no state bleed between sheets (M2-005)', async () => {
    // Simulates a full continuous session: 30 distinct student sheets
    // scanned back to back, zero clicks between them (each is just a new
    // capturedFrame arriving, exactly like a real auto-capture firing —
    // see docs/reports/SHARLO-M2-005.md). Each sheet gets a different
    // correct-count and a different roll digit so a stuck/stale display
    // (state bleeding from a previous sheet) would be caught, not just a
    // wrong-but-plausible number matching by coincidence.
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20, 0)); // key: every question = option 0

    const { rerender } = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/key captured/i);

    for (let i = 0; i < 30; i++) {
      const correctCount = i % 21; // cycles 0..20, exercising every possible score at least once
      // Two digit columns (not one) so all 30 roll numbers are genuinely
      // unique ("00".."29") -- a single digit column can only express 10
      // values, which would make sheet 10 collide with sheet 0 and trip
      // M2-008's duplicate-roll-number gate, a different feature this
      // test isn't exercising.
      const rollString = `${Math.floor(i / 10)}${i % 10}`;
      const studentAnswers = Array.from({ length: 20 }, (_, q) => ({
        outcome: 'answered' as const,
        optionIndex: q < correctCount ? 0 : 1,
      }));
      useManualCaptureMock.mockReturnValue({
        capturedFrame: fakeFrame(2000 + i),
        canCapture: true,
        capture: vi.fn(),
      });
      useSheetReaderMock.mockReturnValue(
        readOutcome(studentAnswers, [
          { outcome: 'answered', optionIndex: Math.floor(i / 10) },
          { outcome: 'answered', optionIndex: i % 10 },
        ]),
      );

      rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

      expect(await screen.findByText(`${correctCount} / 20`)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`roll #${rollString}$`, 'i'))).toBeInTheDocument();
    }
  });

  it('calls onRestart when "End exam" is clicked', async () => {
    const onRestart = vi.fn();
    render(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={onRestart} />);
    (await screen.findByRole('button', { name: /end exam/i })).click();
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('never claims unattended 100% accuracy anywhere on this screen', async () => {
    const { container } = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/scan the answer key sheet first/i);
    const text = container.textContent?.toLowerCase() ?? '';
    for (const phrase of ['100% accura', 'fully automatic', 'guaranteed accura']) {
      expect(text).not.toContain(phrase);
    }
  });

  async function captureKey() {
    useManualCaptureMock.mockReturnValue({
      capturedFrame: fakeFrame(1000),
      canCapture: true,
      capture: vi.fn(),
    });
    useSheetReaderMock.mockReturnValue(allAnswered(20, 0));
    const result = render(
      <ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />,
    );
    await screen.findByText(/key captured/i);
    return result;
  }

  describe('batch import (M2-009)', () => {
    it('shows live progress while running, disables Import files, and reports a summary when done', async () => {
      await captureKey();

      let resolveFirstLoad!: (value: {
        imageUrl: string;
        width: number;
        height: number;
        imageData: unknown;
      }) => void;
      loadImageFileMock.mockReset();
      loadImageFileMock
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstLoad = resolve;
            }),
        )
        .mockResolvedValueOnce({
          imageUrl: 'data:image/jpeg;base64,FAKE',
          width: 2,
          height: 2,
          imageData: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
        });
      detectAndReadSheetMock
        .mockReturnValueOnce({
          status: 'read',
          outcome: readOutcome(allAnswered(20, 0).result.questions, [
            { outcome: 'answered', optionIndex: 5 },
          ]),
        })
        .mockReturnValueOnce({
          status: 'read',
          outcome: readOutcome(allAnswered(20, 0).result.questions, [
            { outcome: 'answered', optionIndex: 6 },
          ]),
        });

      const files = [fakeImageFile('first.jpg'), fakeImageFile('second.jpg')];
      fireEvent.change(screen.getByLabelText(/choose files to import/i), { target: { files } });

      expect(await screen.findByText(/processing sheet 1 of 2/i)).toBeInTheDocument();
      expect(screen.getByText(/first\.jpg/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /import files/i })).toBeDisabled();

      await act(async () => {
        resolveFirstLoad({
          imageUrl: 'data:image/jpeg;base64,FAKE',
          width: 2,
          height: 2,
          imageData: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
        });
      });

      expect(await screen.findByText(/imported 2 sheets/i)).toBeInTheDocument();
      expect(loadImageFileMock).toHaveBeenCalledTimes(2);
      expect(detectAndReadSheetMock).toHaveBeenCalledTimes(2);

      fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
      expect(await screen.findByRole('button', { name: /fully graded/i })).toBeInTheDocument();
      expect(screen.getByText(/roll #6/i)).toBeInTheDocument();
    });

    it('reports an unreadable sheet as a failure without stopping the rest of the batch', async () => {
      await captureKey();

      detectAndReadSheetMock
        .mockReturnValueOnce({ status: 'no-markers-detected' })
        .mockReturnValueOnce({
          status: 'read',
          outcome: readOutcome(allAnswered(20, 0).result.questions, [
            { outcome: 'answered', optionIndex: 3 },
          ]),
        });

      const files = [fakeImageFile('blurry.jpg'), fakeImageFile('good.jpg')];
      fireEvent.change(screen.getByLabelText(/choose files to import/i), { target: { files } });

      expect(await screen.findByText(/imported 1 sheet\b/i)).toBeInTheDocument();
      expect(screen.getByText(/blurry\.jpg/i)).toBeInTheDocument();
      expect(screen.getByText(/couldn.t find the sheet.s corner markers/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
      expect(screen.getByText(/roll #3/i)).toBeInTheDocument();
    });

    it('pauses on a duplicate roll number mid-batch and resumes once the teacher confirms the rescan', async () => {
      const { rerender } = await captureKey();

      useManualCaptureMock.mockReturnValue({
        capturedFrame: fakeFrame(2000),
        canCapture: true,
        capture: vi.fn(),
      });
      useSheetReaderMock.mockReturnValue(
        readOutcome(allAnswered(20, 0).result.questions, [{ outcome: 'answered', optionIndex: 9 }]),
      );
      rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);
      await screen.findByText(/roll #9/i);

      detectAndReadSheetMock
        .mockReturnValueOnce({
          status: 'read',
          outcome: readOutcome(allAnswered(20, 1).result.questions, [
            { outcome: 'answered', optionIndex: 9 },
          ]),
        })
        .mockReturnValueOnce({
          status: 'read',
          outcome: readOutcome(allAnswered(20, 0).result.questions, [
            { outcome: 'answered', optionIndex: 3 },
          ]),
        });

      const files = [fakeImageFile('dup.jpg'), fakeImageFile('ok.jpg')];
      fireEvent.change(screen.getByLabelText(/choose files to import/i), { target: { files } });

      const dialog = await screen.findByRole('alertdialog', {
        name: /duplicate roll number detected/i,
      });
      expect(dialog).toHaveTextContent(/roll #9/i);
      expect(detectAndReadSheetMock).toHaveBeenCalledTimes(1); // the second item hasn't started yet

      fireEvent.click(screen.getByRole('button', { name: /rescan intentionally/i }));

      expect(await screen.findByText(/imported 2 sheets/i)).toBeInTheDocument();
      expect(detectAndReadSheetMock).toHaveBeenCalledTimes(2);
    });

    it('expands a multi-page PDF into one batch item per page, processed in order', async () => {
      await captureKey();

      const loadPageMock = vi
        .fn()
        .mockResolvedValueOnce({
          pageNumber: 1,
          imageUrl: 'data:image/jpeg;base64,FAKE',
          width: 2,
          height: 2,
          imageData: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
        })
        .mockResolvedValueOnce({
          pageNumber: 2,
          imageUrl: 'data:image/jpeg;base64,FAKE',
          width: 2,
          height: 2,
          imageData: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
        });
      loadPdfDocumentMock.mockResolvedValue({ numPages: 2, loadPage: loadPageMock });
      detectAndReadSheetMock
        .mockReturnValueOnce({
          status: 'read',
          outcome: readOutcome(allAnswered(20, 0).result.questions, [
            { outcome: 'answered', optionIndex: 1 },
          ]),
        })
        .mockReturnValueOnce({
          status: 'read',
          outcome: readOutcome(allAnswered(20, 0).result.questions, [
            { outcome: 'answered', optionIndex: 2 },
          ]),
        });

      const pdfFile = new File([], 'scan.pdf', { type: 'application/pdf' });
      fireEvent.change(screen.getByLabelText(/choose files to import/i), {
        target: { files: [pdfFile] },
      });

      expect(await screen.findByText(/imported 2 sheets/i)).toBeInTheDocument();
      expect(loadPageMock).toHaveBeenCalledTimes(2);
      expect(loadPageMock).toHaveBeenNthCalledWith(1, 1);
      expect(loadPageMock).toHaveBeenNthCalledWith(2, 2);
    });

    it('rejects an unsupported file up front as a failure, without touching the loaders', async () => {
      await captureKey();

      const files = [new File([], 'notes.txt', { type: 'text/plain' }), fakeImageFile('good.jpg')];
      detectAndReadSheetMock.mockReturnValueOnce({
        status: 'read',
        outcome: readOutcome(allAnswered(20, 0).result.questions, [
          { outcome: 'answered', optionIndex: 4 },
        ]),
      });

      fireEvent.change(screen.getByLabelText(/choose files to import/i), { target: { files } });

      expect(await screen.findByText(/imported 1 sheet\b/i)).toBeInTheDocument();
      expect(screen.getByText(/notes\.txt/i)).toBeInTheDocument();
      // Only the recognized image file reaches the loader — the
      // unsupported one was rejected up front by `classifyFile`. Checked
      // by name rather than `toHaveBeenCalledWith(files[0])`: jsdom's
      // `File` doesn't expose `name`/`type` as enumerable own properties,
      // so deep-equality-based matchers can't reliably tell two
      // differently-named `File`s apart.
      expect(loadImageFileMock).toHaveBeenCalledTimes(1);
      expect(loadImageFileMock.mock.calls[0]![0].name).toBe('good.jpg');
    });

    it("a batch's own first sheet can serve as the answer key, same as a live-captured one would", async () => {
      // No captureKey() here -- the batch itself supplies the key, from
      // the component's very first render, proving the loop drives
      // applyReadResult's capture-key branch too, not just scan-students.
      render(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);
      await screen.findByText(/scan the answer key sheet first/i);

      detectAndReadSheetMock
        .mockReturnValueOnce({ status: 'read', outcome: allAnswered(20, 0) }) // accepted as the key
        .mockReturnValueOnce({
          status: 'read',
          outcome: readOutcome(allAnswered(20, 0).result.questions, [
            { outcome: 'answered', optionIndex: 8 },
          ]),
        });

      const files = [fakeImageFile('key.jpg'), fakeImageFile('student1.jpg')];
      fireEvent.change(screen.getByLabelText(/choose files to import/i), { target: { files } });

      expect(await screen.findByText(/imported 2 sheets/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^done$/i }));

      expect(await screen.findByText(/key captured/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /fully graded/i })).toBeInTheDocument();
      expect(screen.getByText(/roll #8/i)).toBeInTheDocument();
      expect(screen.getByText('20 / 20')).toBeInTheDocument();
    });
  });
});

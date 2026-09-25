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
} = vi.hoisted(() => ({
  loadOpenCvMock: vi.fn(),
  useCameraStreamMock: vi.fn(),
  useCornerDetectionMock: vi.fn(),
  useAutoCaptureMock: vi.fn(),
  useManualCaptureMock: vi.fn(),
  useSheetReaderMock: vi.fn(),
}));

vi.mock('@/lib/scanning/opencv-loader', () => ({ loadOpenCv: loadOpenCvMock }));
vi.mock('../../scan/use-camera-stream', () => ({ useCameraStream: useCameraStreamMock }));
vi.mock('../../scan/use-corner-detection', () => ({ useCornerDetection: useCornerDetectionMock }));
vi.mock('../../scan/use-auto-capture', () => ({ useAutoCapture: useAutoCaptureMock }));
vi.mock('../../scan/use-manual-capture', () => ({ useManualCapture: useManualCaptureMock }));
vi.mock('./use-sheet-reader', () => ({ useSheetReader: useSheetReaderMock }));

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
});

afterEach(() => {
  cleanup();
  loadOpenCvMock.mockReset();
  useCameraStreamMock.mockReset();
  useCornerDetectionMock.mockReset();
  useAutoCaptureMock.mockReset();
  useManualCaptureMock.mockReset();
  useSheetReaderMock.mockReset();
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
      const rollDigit = i % 10;
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
        readOutcome(studentAnswers, [{ outcome: 'answered', optionIndex: rollDigit }]),
      );

      rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

      expect(await screen.findByText(`${correctCount} / 20`)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`roll #${rollDigit}$`, 'i'))).toBeInTheDocument();
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
});

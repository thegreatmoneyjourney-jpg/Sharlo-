import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamScanFlow } from './exam-scan-flow';
import { computeStockTemplateGeometry } from '@/lib/templates/geometry';
import type { CameraState } from '../../scan/use-camera-stream';
import type { CapturedFrame } from '../../scan/capture-video-frame';
import type { ReadAnswerSheetResult } from '@/lib/scanning/read-answer-sheet';

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

function allAnswered(count: number, optionIndex = 0): ReadAnswerSheetResult {
  return {
    questions: Array.from({ length: count }, () => ({ outcome: 'answered' as const, optionIndex })),
    rollNumberColumns: [{ outcome: 'answered', optionIndex: 4 }],
  };
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
    const flaggedKey: ReadAnswerSheetResult = {
      questions: [{ outcome: 'answered', optionIndex: 0 }, { outcome: 'flagged' }],
      rollNumberColumns: [],
    };
    useSheetReaderMock.mockReturnValue(flaggedKey);

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
    useSheetReaderMock.mockReturnValue({
      questions: studentAnswers,
      rollNumberColumns: [{ outcome: 'answered', optionIndex: 7 }],
    });

    rerender(<ExamScanFlow examTitle="Quiz" geometry={GEOMETRY} onRestart={vi.fn()} />);

    expect(await screen.findByText('18 / 20')).toBeInTheDocument();
    expect(screen.getByText(/roll #7/i)).toBeInTheDocument();
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
      useSheetReaderMock.mockReturnValue({
        questions: studentAnswers,
        rollNumberColumns: [{ outcome: 'answered', optionIndex: rollDigit }],
      });

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

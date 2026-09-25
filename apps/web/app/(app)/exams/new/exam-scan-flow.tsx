'use client';

import { useEffect, useRef, useState } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';
import type { QuestionResult } from '@/lib/scanning/bubble-fill';
import { readRollNumber } from '@/lib/scanning/roll-number';
import { scoreSheet } from '@/lib/scanning/score-answers';
import type { ScoredSheet } from '@/lib/scanning/score-answers';
import type { TemplateGeometry } from '@/lib/templates/geometry';
import { useCameraStream } from '../../scan/use-camera-stream';
import { useCornerDetection } from '../../scan/use-corner-detection';
import { useAutoCapture } from '../../scan/use-auto-capture';
import { useManualCapture } from '../../scan/use-manual-capture';
import type { CapturedFrame } from '../../scan/capture-video-frame';
import { useSheetReader } from './use-sheet-reader';

type Mode =
  | { phase: 'capture-key'; error?: string }
  | {
      phase: 'scan-students';
      key: QuestionResult[];
      lastScan?: { rollNumber: string | null; score: ScoredSheet };
    };

const SECONDARY_BUTTON_CLASSES =
  'rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900';

/**
 * FR-EXAM-03's scan flow — reuses the exact M1 camera/corner-detection/
 * auto-capture/manual-capture hooks `scan-client.tsx` established
 * (imported from the sibling `scan/` route, not duplicated), adding the
 * M2-004 read+score layer on top via `useSheetReader`.
 *
 * The FIRST captured sheet is always interpreted as the answer key
 * (FR-EXAM-03: "Teacher scans the answer key sheet first"). It's only
 * accepted once every question reads as a clean `answered` outcome — a
 * `blank`/`flagged` question on the key itself would make every
 * subsequent score meaningless, so an incomplete key never silently
 * becomes "the key"; the teacher sees exactly which question(s) weren't
 * clear and rescans. `M1-007`'s stability-gate cooldown already resets
 * auto-capture on its own after every capture (the "next sheet, zero
 * clicks" loop), so no manual reset is needed here for either the
 * key-retry or the next-student-sheet case — this component only reacts
 * to whichever capture source (auto or manual) produces a newer frame,
 * tracked by `capturedAt` so it never double-processes the same one.
 */
export function ExamScanFlow({
  geometry,
  onRestart,
}: {
  examTitle: string;
  geometry: TemplateGeometry;
  onRestart: () => void;
}) {
  const [openCvReady, setOpenCvReady] = useState(false);
  const [mode, setMode] = useState<Mode>({ phase: 'capture-key' });
  const videoRef = useRef<HTMLVideoElement>(null);
  const processedAtRef = useRef<number | null>(null);

  const camera = useCameraStream(videoRef);
  const ready = openCvReady && camera.state.status === 'live';
  const autoCapture = useAutoCapture(videoRef);
  const { result: corners } = useCornerDetection(videoRef, ready, autoCapture.onFrame);
  const manualCapture = useManualCapture(videoRef, corners);

  const capturedFrame: CapturedFrame | null =
    autoCapture.capturedFrame && manualCapture.capturedFrame
      ? autoCapture.capturedFrame.capturedAt > manualCapture.capturedFrame.capturedAt
        ? autoCapture.capturedFrame
        : manualCapture.capturedFrame
      : (autoCapture.capturedFrame ?? manualCapture.capturedFrame);

  const readResult = useSheetReader(capturedFrame, geometry);

  useEffect(() => {
    let cancelled = false;
    loadOpenCv()
      .then(() => {
        if (!cancelled) setOpenCvReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!readResult || !capturedFrame) return;
    if (processedAtRef.current === capturedFrame.capturedAt) return;
    processedAtRef.current = capturedFrame.capturedAt;

    setMode((prev) => {
      if (prev.phase === 'capture-key') {
        const unresolved = readResult.questions
          .map((q, i) => (q.outcome === 'answered' ? null : i + 1))
          .filter((n): n is number => n !== null);
        if (unresolved.length === 0) {
          return { phase: 'scan-students', key: readResult.questions };
        }
        return {
          phase: 'capture-key',
          error: `Question${unresolved.length > 1 ? 's' : ''} ${unresolved.join(', ')} ${unresolved.length > 1 ? "weren't" : "wasn't"} clearly marked on the key sheet — hold it steady and scan again.`,
        };
      }

      const rollRead = readRollNumber(readResult.rollNumberColumns);
      const score = scoreSheet(readResult.questions, prev.key);
      return {
        phase: 'scan-students',
        key: prev.key,
        lastScan: { rollNumber: rollRead.status === 'read' ? rollRead.value : null, score },
      };
    });
  }, [readResult, capturedFrame]);

  if (camera.state.status === 'error') {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
        role="alert"
      >
        <p className="max-w-sm text-sm text-red-600 dark:text-red-400">
          Couldn&rsquo;t start the camera. Check your browser&rsquo;s permissions and try again.
        </p>
        <button type="button" onClick={camera.retry} className={SECONDARY_BUTTON_CLASSES}>
          Try again
        </button>
      </div>
    );
  }

  if (!ready) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 p-8"
        role="status"
        aria-live="polite"
      >
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300"
          aria-hidden="true"
        />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading scanner…</p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-black">
      <div className="relative flex flex-1 items-center justify-center">
        <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
        {mode.phase === 'capture-key' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1.5 text-center text-sm text-white">
            Scan the answer key sheet first
          </div>
        )}
        {mode.phase === 'capture-key' && mode.error && (
          <div
            className="absolute top-12 left-1/2 max-w-xs -translate-x-1/2 rounded bg-red-600/90 px-3 py-2 text-center text-xs text-white"
            role="alert"
          >
            {mode.error}
          </div>
        )}
        {mode.phase === 'scan-students' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded bg-emerald-600/90 px-3 py-1.5 text-center text-sm text-white">
            Key captured — scan student sheets
          </div>
        )}
        {mode.phase === 'scan-students' && mode.lastScan && (
          <div
            className="absolute bottom-20 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 rounded bg-black/70 px-4 py-3 text-center text-white"
            role="status"
          >
            <span className="text-xs text-zinc-300">
              {mode.lastScan.rollNumber
                ? `Roll #${mode.lastScan.rollNumber}`
                : 'Roll number not read'}
            </span>
            <span className="text-lg font-semibold">
              {mode.lastScan.score.correctCount} / {mode.lastScan.score.scores.length}
            </span>
            {mode.lastScan.score.needsReviewCount > 0 && (
              <span className="text-xs text-amber-300">
                {mode.lastScan.score.needsReviewCount} question
                {mode.lastScan.score.needsReviewCount > 1 ? 's' : ''} need review
              </span>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={manualCapture.capture}
          disabled={!manualCapture.canCapture}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-6 py-3 text-sm font-medium text-zinc-900 shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Take Photo
        </button>
      </div>
      <button
        type="button"
        onClick={onRestart}
        className="absolute top-2 right-2 rounded bg-black/60 px-3 py-1.5 text-xs text-white hover:bg-black/80"
      >
        End exam
      </button>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';
import type { QuestionResult } from '@/lib/scanning/bubble-fill';
import { applyReviewResolution, rescoreSheet, scoreSheet } from '@/lib/scanning/score-answers';
import type { QuestionResolution, ScoredSheet } from '@/lib/scanning/score-answers';
import type { TemplateGeometry } from '@/lib/templates/geometry';
import { useCameraStream } from '../../scan/use-camera-stream';
import { useCornerDetection } from '../../scan/use-corner-detection';
import { useAutoCapture } from '../../scan/use-auto-capture';
import { useManualCapture } from '../../scan/use-manual-capture';
import type { CapturedFrame } from '../../scan/capture-video-frame';
import { useSheetReader } from './use-sheet-reader';
import { ReviewQueuePanel, purgeExpiredCrops } from './review-queue-panel';
import type { ReviewQueueItem } from './review-queue-panel';

/** One scanned student sheet, accumulated across the whole scan-students session (M2-006) — `scored` is re-derived via `rescoreSheet` whenever a review-queue item for this student is resolved, never hand-edited in place. */
interface StudentResult {
  id: number;
  rollNumber: string | null;
  scored: ScoredSheet;
}

/**
 * M2-008 (FR-DETECT-05): a freshly-read capture whose roll number matches
 * an already-saved student, held here rather than added straight to
 * `students`/`reviewQueue` — "warn... before it's saved" means exactly
 * that: nothing about this capture is committed until the teacher
 * explicitly confirms or cancels it.
 */
interface PendingDuplicate {
  rollNumber: string;
  newStudent: StudentResult;
  newQueueItems: ReviewQueueItem[];
}

type Mode =
  | { phase: 'capture-key'; error?: string }
  | {
      phase: 'scan-students';
      key: QuestionResult[];
      students: StudentResult[];
      reviewQueue: ReviewQueueItem[];
      showReviewQueue: boolean;
      pendingDuplicate: PendingDuplicate | null;
    };

const SECONDARY_BUTTON_CLASSES =
  'rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900';

/**
 * M2-007 (FR-REVIEW-03, NFR-SEC-05): "purged on a short timer / session
 * end." Session end is already covered for free — the whole review queue
 * lives in this component's own state, gone the instant it unmounts
 * ("End exam" or a tab close). No numeric window is specified anywhere in
 * docs/SRS.md or docs/ARCHITECTURE.md, so 15 minutes is a judgment call,
 * not a confirmed figure — long enough that a teacher who steps away
 * mid-review (answering a knock at the classroom door) doesn't lose their
 * place, short enough to be a real control rather than a token gesture.
 * Flagged in docs/reports/SHARLO-M2-007.md for founder confirmation.
 */
const REVIEW_IMAGE_RETENTION_MS = 15 * 60 * 1000;
/** How often the purge check runs — frequent enough that no image lingers materially past its window, cheap enough (a length-N array scan over what's realistically a handful of open items) not to matter. */
const RETENTION_CHECK_INTERVAL_MS = 30 * 1000;

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
        const unresolved = readResult.result.questions
          .map((q, i) => (q.outcome === 'answered' ? null : i + 1))
          .filter((n): n is number => n !== null);
        if (unresolved.length === 0) {
          return {
            phase: 'scan-students',
            key: readResult.result.questions,
            students: [],
            reviewQueue: [],
            showReviewQueue: false,
            pendingDuplicate: null,
          };
        }
        return {
          phase: 'capture-key',
          error: `Question${unresolved.length > 1 ? 's' : ''} ${unresolved.join(', ')} ${unresolved.length > 1 ? "weren't" : "wasn't"} clearly marked on the key sheet — hold it steady and scan again.`,
        };
      }

      // A decision on the last capture is still pending — ignore further
      // captures rather than letting a second one silently interfere with
      // (or get lost behind) the one the teacher hasn't resolved yet.
      if (prev.pendingDuplicate) return prev;

      const studentId = capturedFrame.capturedAt;
      const rollNumber = readResult.rollRead.status === 'read' ? readResult.rollRead.value : null;
      const scored = scoreSheet(readResult.result.questions, prev.key);
      const newStudent: StudentResult = { id: studentId, rollNumber, scored };

      const addedAt = Date.now();
      const newQueueItems: ReviewQueueItem[] = readResult.reviewCrops.map((crop) =>
        crop.kind === 'question'
          ? {
              id: `${studentId}-q${crop.questionNumber}`,
              studentId,
              addedAt,
              cropDataUrl: crop.cropDataUrl,
              kind: 'question',
              questionNumber: crop.questionNumber,
              optionCount: geometry.questions[crop.questionNumber - 1]?.options.length ?? 0,
            }
          : {
              id: `${studentId}-roll`,
              studentId,
              addedAt,
              cropDataUrl: crop.cropDataUrl,
              kind: 'roll-number',
            },
      );

      // FR-DETECT-05: same roll number already scanned for this exam ->
      // hold the capture for confirmation rather than saving it straight
      // away. Roll-number-only matching, not FR-DETECT-05's own "or a
      // matching visual fingerprint" alternative — see
      // docs/reports/SHARLO-M2-008.md's Flags for why that's out of
      // scope here rather than half-built.
      if (rollNumber !== null && prev.students.some((s) => s.rollNumber === rollNumber)) {
        return { ...prev, pendingDuplicate: { rollNumber, newStudent, newQueueItems } };
      }

      return {
        ...prev,
        students: [...prev.students, newStudent],
        reviewQueue: [...prev.reviewQueue, ...newQueueItems],
      };
    });
  }, [readResult, capturedFrame, geometry]);

  // M2-007 (FR-REVIEW-03): purges each review item's crop image once it's
  // sat unresolved past REVIEW_IMAGE_RETENTION_MS, regardless of whether
  // the panel is open — this is about not *retaining* the data, not just
  // not *displaying* it, so the check runs on its own timer rather than
  // waiting for some other render to trigger it. Never drops the item
  // itself: a flagged question that quietly vanished because nobody
  // opened the queue in time would be exactly the "silently dropped"
  // failure this whole feature exists to prevent (see CLAUDE.md's
  // never-guess/never-drop trust guarantee).
  useEffect(() => {
    if (mode.phase !== 'scan-students') return;
    const intervalId = setInterval(() => {
      setMode((prev) => {
        if (prev.phase !== 'scan-students') return prev;
        const reviewQueue = purgeExpiredCrops(
          prev.reviewQueue,
          Date.now(),
          REVIEW_IMAGE_RETENTION_MS,
        );
        return reviewQueue === prev.reviewQueue ? prev : { ...prev, reviewQueue };
      });
    }, RETENTION_CHECK_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [mode.phase]);

  function resolveQuestionItem(
    item: Extract<ReviewQueueItem, { kind: 'question' }>,
    resolution: QuestionResolution,
  ) {
    setMode((prev) => {
      if (prev.phase !== 'scan-students') return prev;
      const keyEntry = prev.key[item.questionNumber - 1]!;
      const students = prev.students.map((student) => {
        if (student.id !== item.studentId) return student;
        const scores = [...student.scored.scores];
        scores[item.questionNumber - 1] = applyReviewResolution(resolution, keyEntry);
        return { ...student, scored: rescoreSheet(scores) };
      });
      return {
        ...prev,
        students,
        reviewQueue: prev.reviewQueue.filter((queued) => queued.id !== item.id),
      };
    });
  }

  function resolveRollNumberItem(
    item: Extract<ReviewQueueItem, { kind: 'roll-number' }>,
    rollNumber: string,
  ) {
    setMode((prev) => {
      if (prev.phase !== 'scan-students') return prev;
      const students = prev.students.map((student) =>
        student.id === item.studentId ? { ...student, rollNumber } : student,
      );
      return {
        ...prev,
        students,
        reviewQueue: prev.reviewQueue.filter((queued) => queued.id !== item.id),
      };
    });
  }

  /** FR-DETECT-05's "teacher can override with 'rescan intentionally'" — replaces the prior entry for that roll number with the new capture, since a rescan corrects that student's result rather than adding a second, conflicting one. Also drops the superseded entry's own review-queue items, if any: they referred to a scan that no longer exists. */
  function confirmRescan() {
    setMode((prev) => {
      if (prev.phase !== 'scan-students' || !prev.pendingDuplicate) return prev;
      const { newStudent, newQueueItems } = prev.pendingDuplicate;
      const supersededId = prev.students.find((s) => s.rollNumber === newStudent.rollNumber)?.id;
      return {
        ...prev,
        students: [...prev.students.filter((s) => s.id !== supersededId), newStudent],
        reviewQueue: [
          ...prev.reviewQueue.filter((item) => item.studentId !== supersededId),
          ...newQueueItems,
        ],
        pendingDuplicate: null,
      };
    });
  }

  /** Discards the pending capture entirely — nothing about it was ever saved, matching FR-DETECT-05's "triggers a warning before it's saved." */
  function cancelRescan() {
    setMode((prev) =>
      prev.phase === 'scan-students' ? { ...prev, pendingDuplicate: null } : prev,
    );
  }

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
        {mode.phase === 'scan-students' &&
          mode.students.length > 0 &&
          (() => {
            const lastStudent = mode.students[mode.students.length - 1]!;
            const gradedCount = lastStudent.scored.scores.length - lastStudent.scored.excludedCount;
            return (
              <div
                className="absolute bottom-20 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 rounded bg-black/70 px-4 py-3 text-center text-white"
                role="status"
              >
                <span className="text-xs text-zinc-300">
                  {lastStudent.rollNumber
                    ? `Roll #${lastStudent.rollNumber}`
                    : 'Roll number not read'}
                </span>
                <span className="text-lg font-semibold">
                  {lastStudent.scored.correctCount} / {gradedCount}
                </span>
                {lastStudent.scored.needsReviewCount > 0 && (
                  <span className="text-xs text-amber-300">
                    {lastStudent.scored.needsReviewCount} question
                    {lastStudent.scored.needsReviewCount > 1 ? 's' : ''} need review
                  </span>
                )}
              </div>
            );
          })()}
        <button
          type="button"
          onClick={manualCapture.capture}
          disabled={!manualCapture.canCapture}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-6 py-3 text-sm font-medium text-zinc-900 shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Take Photo
        </button>
        {mode.phase === 'scan-students' && mode.showReviewQueue && (
          <ReviewQueuePanel
            items={mode.reviewQueue}
            onResolveQuestion={resolveQuestionItem}
            onResolveRollNumber={resolveRollNumberItem}
            onClose={() =>
              setMode((prev) =>
                prev.phase === 'scan-students' ? { ...prev, showReviewQueue: false } : prev,
              )
            }
          />
        )}
        {mode.phase === 'scan-students' && mode.pendingDuplicate && (
          <div
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/95 p-6 text-center text-white"
            role="alertdialog"
            aria-label="Duplicate roll number detected"
          >
            <p className="max-w-xs text-sm">
              Roll #{mode.pendingDuplicate.rollNumber} was already scanned for this exam.
            </p>
            <p className="max-w-xs text-xs text-zinc-400">
              Rescanning will replace that student&rsquo;s saved result with this new one.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={cancelRescan}
                className="rounded border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRescan}
                className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                Rescan intentionally
              </button>
            </div>
          </div>
        )}
      </div>
      {mode.phase === 'scan-students' && mode.students.length > 0 && (
        <button
          type="button"
          onClick={() =>
            setMode((prev) =>
              prev.phase === 'scan-students' ? { ...prev, showReviewQueue: true } : prev,
            )
          }
          className="absolute top-2 left-2 rounded bg-black/60 px-3 py-1.5 text-xs text-white hover:bg-black/80"
        >
          {mode.reviewQueue.length > 0
            ? `Review Needed (${mode.reviewQueue.length})`
            : 'Fully graded'}
        </button>
      )}
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

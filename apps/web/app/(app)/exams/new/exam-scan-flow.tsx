'use client';

import { useEffect, useRef, useState } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';
import { applyReviewResolution, rescoreSheet } from '@/lib/scanning/score-answers';
import type { QuestionResolution } from '@/lib/scanning/score-answers';
import type { TemplateGeometry } from '@/lib/templates/geometry';
import { useCameraStream } from '../../scan/use-camera-stream';
import { useCornerDetection } from '../../scan/use-corner-detection';
import { useAutoCapture } from '../../scan/use-auto-capture';
import { useManualCapture } from '../../scan/use-manual-capture';
import type { CapturedFrame } from '../../scan/capture-video-frame';
import { useSheetReader } from './use-sheet-reader';
import { ReviewQueuePanel, purgeExpiredCrops } from './review-queue-panel';
import type { ReviewQueueItem } from './review-queue-panel';
import { applyReadResult } from './exam-scan-mode';
import type { Mode } from './exam-scan-mode';
import { detectAndReadSheet } from '@/lib/scanning/read-sheet-from-image';
import { loadImageFile } from '@/lib/scanning/load-image-file';
import {
  advanceBatch,
  buildBatchQueue,
  keyAttemptRejection,
  startBatch,
  NO_SHEET_DETECTED_REASON,
} from './batch-import';
import type { BatchImportState } from './batch-import';

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
  const [batch, setBatch] = useState<BatchImportState | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processedAtRef = useRef<number | null>(null);
  const batchActive = batch !== null && batch.phase !== 'done';

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
    if (batchActive) return; // a batch import owns `mode` updates while it runs — see the batch-processing effect below
    if (processedAtRef.current === capturedFrame.capturedAt) return;
    processedAtRef.current = capturedFrame.capturedAt;

    setMode((prev) =>
      applyReadResult(prev, {
        readResult,
        studentId: capturedFrame.capturedAt,
        addedAt: Date.now(),
        geometry,
      }),
    );
  }, [readResult, capturedFrame, geometry, batchActive]);

  // M2-009 (FR-EXAM-04): drives a batch import one sheet at a time,
  // through the exact same `applyReadResult` live capture uses (never a
  // parallel reimplementation — see read-sheet-from-image.ts's own doc
  // comment). Keyed on `[batch, mode, geometry]` rather than any manual
  // async chaining: `applyReadResult` already returns `pendingDuplicate`
  // set instead of saving a colliding roll number, so this effect's own
  // guard clause below naturally stops advancing the moment that happens
  // and picks back up on its own once the teacher's existing
  // confirm/cancel handlers clear it — no separate pause/resume plumbing
  // needed. Safe to read `mode` directly (not via a `setMode` updater)
  // because nothing else can mutate it while a batch is active: the live
  // effect above stands down via `batchActive`, and the review-queue
  // button that could otherwise race a resolve against this is disabled
  // for the same reason (see the render below).
  useEffect(() => {
    if (!batch || batch.phase !== 'processing') return;
    if (mode.phase === 'scan-students' && mode.pendingDuplicate) return; // paused on a pending duplicate

    let cancelled = false;
    const item = batch.items[batch.index]!;

    void (async () => {
      let failure: { label: string; reason: string } | undefined;
      let nextMode: Mode | null = null;

      try {
        const [{ cv }, loaded] = await Promise.all([
          loadOpenCv(),
          item.kind === 'image' ? loadImageFile(item.file) : item.doc.loadPage(item.pageNumber),
        ]);
        if (cancelled) return;

        const detected = detectAndReadSheet(cv, loaded.imageData, geometry);
        if (detected.status === 'no-markers-detected') {
          failure = { label: item.label, reason: NO_SHEET_DETECTED_REASON };
        } else {
          nextMode = applyReadResult(mode, {
            readResult: detected.outcome,
            studentId: Date.now() + batch.index,
            addedAt: Date.now(),
            geometry,
          });
          const rejection = keyAttemptRejection(mode, nextMode);
          if (rejection) failure = { label: item.label, reason: rejection };
        }
      } catch (err) {
        failure = {
          label: item.label,
          reason: err instanceof Error ? err.message : "Couldn't process this file.",
        };
      }

      if (cancelled) return;
      if (nextMode) setMode(nextMode);
      setBatch((prev) => (prev ? advanceBatch(prev, failure) : prev));
    })();

    return () => {
      cancelled = true;
    };
  }, [batch, mode, geometry]);

  async function handleFilesPicked(fileList: FileList) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setBatch({ phase: 'preparing' });
    const { items, failures } = await buildBatchQueue(files);
    setBatch(startBatch(items, failures));
  }

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
        {batch?.phase === 'preparing' && (
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1.5 text-center text-sm text-white"
            role="status"
            aria-live="polite"
          >
            Preparing files…
          </div>
        )}
        {batch?.phase === 'processing' && (
          <div
            className="absolute top-2 left-1/2 flex -translate-x-1/2 flex-col items-center gap-0.5 rounded bg-black/70 px-3 py-1.5 text-center text-white"
            role="status"
            aria-live="polite"
          >
            <span className="text-sm">
              Processing sheet {batch.index + 1} of {batch.items.length}
            </span>
            <span className="max-w-[80vw] truncate text-xs text-zinc-300">
              {batch.items[batch.index]!.label}
            </span>
          </div>
        )}
        {!batchActive && mode.phase === 'capture-key' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1.5 text-center text-sm text-white">
            Scan the answer key sheet first
          </div>
        )}
        {!batchActive && mode.phase === 'capture-key' && mode.error && (
          <div
            className="absolute top-12 left-1/2 max-w-xs -translate-x-1/2 rounded bg-red-600/90 px-3 py-2 text-center text-xs text-white"
            role="alert"
          >
            {mode.error}
          </div>
        )}
        {!batchActive && mode.phase === 'scan-students' && (
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
          disabled={!manualCapture.canCapture || batchActive}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-6 py-3 text-sm font-medium text-zinc-900 shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Take Photo
        </button>
        {mode.phase === 'scan-students' && !batchActive && mode.showReviewQueue && (
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
        {batch?.phase === 'done' && (
          <div
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/95 p-6 text-center text-white"
            role="alertdialog"
            aria-label="Batch import finished"
          >
            <p className="text-sm">
              Imported {batch.succeeded} sheet{batch.succeeded === 1 ? '' : 's'}.
            </p>
            {batch.failures.length > 0 && (
              <div className="max-h-48 w-full max-w-xs overflow-y-auto rounded bg-red-950/60 p-3 text-left">
                <p className="mb-1.5 text-xs font-medium text-red-300">
                  {batch.failures.length} sheet{batch.failures.length === 1 ? '' : 's'} didn&rsquo;t
                  come through:
                </p>
                <ul className="space-y-1.5">
                  {batch.failures.map((failure, i) => (
                    <li key={i} className="text-xs text-zinc-300">
                      <span className="font-medium text-white">{failure.label}</span>
                      {' — '}
                      {failure.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              onClick={() => setBatch(null)}
              className="rounded bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
            >
              Done
            </button>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        aria-label="Choose files to import"
        className="hidden"
        onChange={(e) => {
          const { files } = e.target;
          if (files) void handleFilesPicked(files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={batchActive}
        className="absolute top-12 right-2 rounded bg-black/60 px-3 py-1.5 text-xs text-white hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Import files
      </button>
      {mode.phase === 'scan-students' && mode.students.length > 0 && (
        <button
          type="button"
          disabled={batchActive}
          onClick={() =>
            setMode((prev) =>
              prev.phase === 'scan-students' ? { ...prev, showReviewQueue: true } : prev,
            )
          }
          className="absolute top-2 left-2 rounded bg-black/60 px-3 py-1.5 text-xs text-white hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40"
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

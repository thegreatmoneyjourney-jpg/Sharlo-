'use client';

import { useEffect, useRef, useState } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';
import { useCameraStream } from './use-camera-stream';
import { useCornerDetection } from './use-corner-detection';
import { useAutoCapture } from './use-auto-capture';
import { useManualCapture } from './use-manual-capture';
import { useDewarp } from './use-dewarp';
import type { CameraErrorReason } from '@/lib/scanning/camera';
import type { DetectedCorner } from '@/lib/scanning/corner-markers';

type OpenCvPhase = 'loading' | 'ready' | 'error';

const CAMERA_ERROR_COPY: Record<CameraErrorReason, { message: string; canRetry: boolean }> = {
  'permission-denied': {
    message:
      'Camera access was denied. Check your browser’s site settings to allow the camera for this page, then try again.',
    canRetry: true,
  },
  'no-camera-found': {
    message: 'No camera was found on this device.',
    canRetry: true,
  },
  'camera-in-use': {
    message:
      'The camera couldn’t be started — it may be in use by another app. Close other apps using the camera and try again.',
    canRetry: true,
  },
  'insecure-context': {
    message: 'Camera access requires a secure (HTTPS) connection.',
    canRetry: false,
  },
  unsupported: {
    message:
      'This browser doesn’t support camera access. Try a recent version of Chrome, Safari, or Edge.',
    canRetry: false,
  },
  unknown: {
    message: 'Couldn’t start the camera. Check your connection and try again.',
    canRetry: true,
  },
};

/**
 * Client-only scan page body. Covers OpenCV.js lazy-load (M1-001), the
 * camera capture pipeline (M1-002), corner marker detection running
 * continuously against the live frames (M1-003), the stability gate +
 * auto-capture trigger (M1-004), and the perspective transform that
 * dewarps a captured frame to a normalized rectangle once it's ready
 * (M1-005). Grid sampling/scoring and real capture feedback (beep/
 * vibration) are M1-006 onward; this page detects, stabilizes,
 * captures, and dewarps, but doesn't yet read or score any bubbles.
 * Also covers the manual "Take Photo" fallback (M1-008) — always
 * available once the camera is live, independent of the auto-capture
 * gate's own state, for when its timing isn't reliable.
 */
export default function ScanClient() {
  const [openCvPhase, setOpenCvPhase] = useState<OpenCvPhase>('loading');
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const thumbnailRef = useRef<HTMLCanvasElement>(null);
  const dewarpedRef = useRef<HTMLCanvasElement>(null);
  const manualThumbnailRef = useRef<HTMLCanvasElement>(null);
  const manualDewarpedRef = useRef<HTMLCanvasElement>(null);
  const camera = useCameraStream(videoRef);
  const ready = openCvPhase === 'ready' && camera.state.status === 'live';
  const autoCapture = useAutoCapture(videoRef);
  const { result: corners, measuredFps } = useCornerDetection(videoRef, ready, autoCapture.onFrame);
  const manualCapture = useManualCapture(videoRef, corners);
  const dewarped = useDewarp(autoCapture.capturedFrame);
  const manualDewarped = useDewarp(manualCapture.capturedFrame);

  useEffect(() => {
    let cancelled = false;

    // loadOpenCv() resolves with { cv }, not cv directly — never destructure
    // and return/resolve the bare cv through another promise; see
    // OpenCvHandle's doc comment in opencv-loader.ts.
    loadOpenCv()
      .then(() => {
        if (!cancelled) setOpenCvPhase('ready');
      })
      .catch(() => {
        if (!cancelled) setOpenCvPhase('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Draws the current detection result on a canvas overlaid on the video
  // — a green dot per confirmed corner once all 4 are found, amber for
  // whichever subset is found so far. Purely a visual aid proving the
  // detection loop actually runs against live frames (M1-003); the
  // stability gate driven off these same per-frame results is below.
  useEffect(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!corners) return;

    const points: DetectedCorner[] = corners.complete
      ? Object.values(corners.corners)
      : Object.values(corners.found);
    const color = corners.complete ? '#22c55e' : '#f59e0b';

    for (const corner of points) {
      ctx.beginPath();
      ctx.arc(corner.center.x, corner.center.y, 14, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }, [corners]);

  // Renders the most recently auto-captured frame as a small thumbnail —
  // visual proof the stability gate actually grabbed a real frame, not
  // just that its internal state machine reached 'captured'. Acting on
  // this frame (dewarp, grid sampling) is M1-005 onward.
  useEffect(() => {
    const canvas = thumbnailRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!autoCapture.capturedFrame) return;

    const { imageData } = autoCapture.capturedFrame;
    const full = document.createElement('canvas');
    full.width = imageData.width;
    full.height = imageData.height;
    const fullCtx = full.getContext('2d');
    if (!fullCtx) return;
    fullCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  }, [autoCapture.capturedFrame]);

  // Renders the M1-005 perspective-transform output once it's ready —
  // visual proof the dewarp actually ran against a real captured frame
  // and produced a normalized rectangle, not just that the Mat pipeline
  // completed without throwing. Acting on this rectified image (grid
  // sampling, scoring) is M1-006 onward.
  useEffect(() => {
    const canvas = dewarpedRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dewarped) return;

    const full = document.createElement('canvas');
    full.width = dewarped.width;
    full.height = dewarped.height;
    const fullCtx = full.getContext('2d');
    if (!fullCtx) return;
    fullCtx.putImageData(dewarped.imageData, 0, 0);
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  }, [dewarped]);

  // Same rendering as the two effects above, for the manual-capture
  // path (M1-008) — a separate, independent thumbnail pair rather than
  // merged into the auto-capture ones, so each path's own result stays
  // distinguishable proof it works on its own.
  useEffect(() => {
    const canvas = manualThumbnailRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!manualCapture.capturedFrame) return;

    const { imageData } = manualCapture.capturedFrame;
    const full = document.createElement('canvas');
    full.width = imageData.width;
    full.height = imageData.height;
    const fullCtx = full.getContext('2d');
    if (!fullCtx) return;
    fullCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  }, [manualCapture.capturedFrame]);

  useEffect(() => {
    const canvas = manualDewarpedRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!manualDewarped) return;

    const full = document.createElement('canvas');
    full.width = manualDewarped.width;
    full.height = manualDewarped.height;
    const fullCtx = full.getContext('2d');
    if (!fullCtx) return;
    fullCtx.putImageData(manualDewarped.imageData, 0, 0);
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  }, [manualDewarped]);

  if (openCvPhase === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center p-8" role="alert">
        <p className="text-sm text-red-600 dark:text-red-400">
          Couldn&rsquo;t load the scanner. Check your connection and reload the page.
        </p>
      </div>
    );
  }

  if (camera.state.status === 'error') {
    const { message, canRetry } = CAMERA_ERROR_COPY[camera.state.reason];
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
        role="alert"
      >
        <p className="max-w-sm text-sm text-red-600 dark:text-red-400">{message}</p>
        {canRetry && (
          <button
            type="button"
            onClick={camera.retry}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Try again
          </button>
        )}
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
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
      {/* playsInline is required on iOS Safari, which otherwise forces
          fullscreen playback; muted+autoPlay is required there too, for
          the stream to start without an explicit user gesture on the
          video element itself. */}
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
      {/* Sized to the video's intrinsic pixels (matched in the drawing
          effect above) and scaled by the same object-cover CSS as the
          video, so detected-corner coordinates line up without manual
          scaling math. pointer-events-none so it never blocks taps. */}
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      {measuredFps !== null && (
        <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 font-mono text-xs text-white">
          {measuredFps.toFixed(1)} fps
        </div>
      )}
      {autoCapture.status === 'stabilizing' && (
        <div
          className="absolute right-2 bottom-2 rounded bg-black/60 px-2 py-1 font-mono text-xs text-white"
          role="status"
        >
          Hold steady… {Math.round(autoCapture.progress * 100)}%
        </div>
      )}
      {(autoCapture.status === 'captured' || autoCapture.status === 'cooldown') && (
        <div className="absolute right-2 bottom-2 flex flex-col items-end gap-1" role="status">
          <span className="rounded bg-emerald-600/90 px-2 py-1 font-mono text-xs text-white">
            Captured
          </span>
          <canvas
            ref={thumbnailRef}
            width={90}
            height={117}
            className="rounded border border-white/50"
          />
          {dewarped && (
            <>
              <span className="rounded bg-sky-600/90 px-2 py-1 font-mono text-xs text-white">
                Dewarped
              </span>
              <canvas
                ref={dewarpedRef}
                width={90}
                height={117}
                className="rounded border border-white/50"
              />
            </>
          )}
        </div>
      )}
      {manualCapture.capturedFrame && (
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1" role="status">
          <span className="rounded bg-violet-600/90 px-2 py-1 font-mono text-xs text-white">
            Manual capture
          </span>
          <canvas
            ref={manualThumbnailRef}
            width={90}
            height={117}
            className="rounded border border-white/50"
          />
          {manualDewarped && (
            <>
              <span className="rounded bg-sky-600/90 px-2 py-1 font-mono text-xs text-white">
                Dewarped
              </span>
              <canvas
                ref={manualDewarpedRef}
                width={90}
                height={117}
                className="rounded border border-white/50"
              />
            </>
          )}
        </div>
      )}
      {/* FR-SCAN-04: always available once the camera is live, regardless
          of the auto-capture gate's own state — the explicit fallback for
          when its timing isn't reliable (iOS Safari, per this task's own
          done-when criterion). Disabled rather than hidden when corners
          aren't fully detected yet, since there's nothing valid to hand
          to the dewarp step without them — same baseline requirement
          auto-capture has, this button only removes the stability wait. */}
      <button
        type="button"
        onClick={manualCapture.capture}
        disabled={!manualCapture.canCapture}
        className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-6 py-3 text-sm font-medium text-zinc-900 shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
      >
        Take Photo
      </button>
    </div>
  );
}

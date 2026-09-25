'use client';

import { useEffect, useRef, useState } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';
import { useCameraStream } from './use-camera-stream';
import type { CameraErrorReason } from '@/lib/scanning/camera';

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
 * Client-only scan page body. Rendering here stays intentionally minimal —
 * this proves the OpenCV.js lazy-load lifecycle (M1-001) and the camera
 * capture pipeline (M1-002): permission handling, live preview, a clear
 * recovery path when permission is denied. Corner detection running
 * against the live frames, the stability gate, and auto-capture are
 * M1-003 onward — this page doesn't yet do anything with the frames
 * beyond displaying them.
 */
export default function ScanClient() {
  const [openCvPhase, setOpenCvPhase] = useState<OpenCvPhase>('loading');
  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useCameraStream(videoRef);

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

  const ready = openCvPhase === 'ready' && camera.state.status === 'live';

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
    </div>
  );
}

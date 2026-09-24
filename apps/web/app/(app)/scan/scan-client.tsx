'use client';

import { useEffect, useState } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';

type LoadPhase = 'loading' | 'ready' | 'error';

/**
 * Client-only scan page body. Rendering here stays intentionally minimal —
 * this only proves the OpenCV.js lazy-load lifecycle (M1-001). Camera
 * capture, corner detection, and everything downstream land in M1-002+.
 */
export default function ScanClient() {
  const [phase, setPhase] = useState<LoadPhase>('loading');

  useEffect(() => {
    let cancelled = false;

    // loadOpenCv() resolves with { cv }, not cv directly — never destructure
    // and return/resolve the bare cv through another promise; see
    // OpenCvHandle's doc comment in opencv-loader.ts.
    loadOpenCv()
      .then(() => {
        if (!cancelled) setPhase('ready');
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center p-8" role="alert">
        <p className="text-sm text-red-600 dark:text-red-400">
          Couldn&rsquo;t load the scanner. Check your connection and reload the page.
        </p>
      </div>
    );
  }

  if (phase === 'loading') {
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
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Scanner ready. Camera capture is coming in M1-002.
      </p>
    </div>
  );
}

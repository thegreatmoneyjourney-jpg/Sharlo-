import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { CameraError, getCameraStream, stopCameraStream } from '@/lib/scanning/camera';
import type { CameraErrorReason } from '@/lib/scanning/camera';

export type CameraState =
  { status: 'requesting' } | { status: 'live' } | { status: 'error'; reason: CameraErrorReason };

/**
 * Requests the camera on mount, attaches the resulting stream to
 * `videoRef` (owned by the caller, not this hook — returning a ref
 * bundled into an object confuses the react-hooks/refs lint rule's
 * static analysis of what's safe to read during render), and stops
 * every track on unmount — a stream left running after the user leaves
 * the page is a real camera-still-on indicator bug, not just a resource
 * leak.
 *
 * Exposes `retry()` for the error state's recovery path: re-running
 * `getUserMedia` is the only way to know whether a permission the user
 * just changed in browser settings now succeeds, since the Permissions
 * API this could otherwise poll isn't supported on Safari.
 */
export function useCameraStream(videoRef: RefObject<HTMLVideoElement | null>): {
  state: CameraState;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CameraState>({ status: 'requesting' });
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    getCameraStream()
      .then((stream) => {
        if (cancelled) {
          stopCameraStream(stream);
          return;
        }
        streamRef.current = stream;
        // NOT `if (videoRef.current) videoRef.current.srcObject = stream`
        // here: the <video> element only mounts once `state` becomes
        // 'live' (the caller's `ready` gate checks this status), which is
        // the render *after* this callback runs — so `videoRef.current`
        // is still null at this exact point on every real run, not just
        // occasionally. The effect below, which re-checks on every
        // render, is what actually attaches it once the element exists.
        setState({ status: 'live' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const reason = error instanceof CameraError ? error.reason : 'unknown';
        setState({ status: 'error', reason });
      });

    return () => {
      cancelled = true;
      if (streamRef.current) {
        stopCameraStream(streamRef.current);
        streamRef.current = null;
      }
    };
    // videoRef is included for the linter's benefit — it's a stable
    // object identity across renders (owned by the caller's own useRef),
    // so this never actually causes an extra re-run; `attempt` is what
    // triggers a retry.
  }, [attempt, videoRef]);

  // Deliberately no dependency array: this needs to re-check on every
  // render, cheaply, because the stream (set above) and the <video>
  // element's mount (gated on `state` becoming 'live', in the parent
  // component) land on different renders, in either order depending on
  // exactly when the browser paints — this is the standard React pattern
  // for syncing an imperative ref to async-resolved state.
  useEffect(() => {
    if (streamRef.current && videoRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  });

  const retry = useCallback(() => {
    // Reset synchronously here (a user-triggered event handler), not at
    // the top of the effect body — setState directly inside an effect
    // causes an extra cascading render the react-hooks/set-state-in-effect
    // rule flags, and this way the "requesting" UI shows immediately on
    // click rather than one render later.
    setState({ status: 'requesting' });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}

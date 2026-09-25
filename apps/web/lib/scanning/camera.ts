/**
 * Camera stream acquisition — framework-agnostic, per ARCHITECTURE.md §3's
 * requirement for `/lib/scanning`. Wraps `getUserMedia` with the
 * constraints this app needs and classifies failures into a typed reason
 * a UI can act on, rather than surfacing raw `DOMException` names.
 *
 * Deliberately does NOT use the Permissions API (`navigator.permissions
 * .query({ name: 'camera' })`) as the source of truth: Safari (desktop and
 * iOS) has never implemented a camera permission query, so any code path
 * that depends on it silently breaks there. `getUserMedia`'s own
 * resolve/reject is the only permission signal that works on every
 * browser this product targets, so that's what CameraErrorReason is
 * derived from.
 */

export type CameraErrorReason =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'no-camera-found'
  | 'camera-in-use'
  | 'unknown';

export class CameraError extends Error {
  readonly reason: CameraErrorReason;

  constructor(reason: CameraErrorReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CameraError';
    this.reason = reason;
  }
}

function classifyGetUserMediaError(error: unknown): CameraError {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new CameraError('permission-denied', 'Camera permission was denied.', {
          cause: error,
        });
      case 'NotFoundError':
      case 'OverconstrainedError':
        return new CameraError('no-camera-found', 'No usable camera was found on this device.', {
          cause: error,
        });
      case 'NotReadableError':
        return new CameraError(
          'camera-in-use',
          'The camera could not be started — it may be in use by another app.',
          { cause: error },
        );
      default:
        return new CameraError('unknown', `Camera access failed: ${error.name}`, {
          cause: error,
        });
    }
  }
  return new CameraError('unknown', 'Camera access failed for an unknown reason.', {
    cause: error,
  });
}

/**
 * Requests a live camera stream, preferring the rear/environment-facing
 * camera (this is a document-scanning app — the front camera is never
 * useful here) at an ideal-but-not-required resolution, so a low-end
 * device still gets a stream instead of a hard failure.
 *
 * Throws `CameraError` with a `reason` a caller can branch UI on, never a
 * raw `DOMException` — checked before calling `getUserMedia` at all where
 * the failure is otherwise undiagnosable (insecure context, no API).
 */
export async function getCameraStream(): Promise<MediaStream> {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    // getUserMedia is unavailable outside a secure context (HTTPS, or
    // localhost for local dev) and fails with an opaque error otherwise —
    // worth distinguishing so the UI can say something actionable.
    throw new CameraError(
      'insecure-context',
      'Camera access requires a secure (HTTPS) connection.',
    );
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', "This browser doesn't support camera access.");
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  } catch (error) {
    throw classifyGetUserMediaError(error);
  }
}

/** Stops every track on the stream — always call on unmount/navigation-away, never let a stream outlive its component. */
export function stopCameraStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

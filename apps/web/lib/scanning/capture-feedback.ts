/**
 * Capture feedback (FR-SCAN-03) — audible beep + device vibration
 * confirming an auto-capture fired. Framework-agnostic, per
 * ARCHITECTURE.md §3, though unlike the rest of `lib/scanning` this
 * talks to browser platform APIs (Web Audio, Vibration) rather than
 * OpenCV — still no React/DOM dependency beyond globals every browser
 * environment provides.
 *
 * Neither API is guaranteed: the Vibration API has never been
 * implemented on iOS Safari (a permanent platform limitation, not a
 * bug — same class of gap NFR-USE-03's manual "Take Photo" fallback
 * already exists to cover), and `AudioContext` playback can be
 * suspended by a browser's autoplay policy until a user gesture
 * unlocks it. Both functions are feature-detected and never throw —
 * feedback failing must never block or interfere with the capture
 * pipeline itself. See docs/reports/SHARLO-M1-007.md.
 */

// Reused across calls rather than constructed fresh each time: the Web
// Audio API expects one long-lived AudioContext per page, not one per
// sound (each `playCaptureBeep()` call creates its own short-lived
// OscillatorNode against this shared context instead).
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  audioContext = new AudioContextClass();
  return audioContext;
}

/** A short (150ms), clearly audible confirmation tone. */
export function playCaptureBeep(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.frequency.value = 880; // A5
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    // exponentialRampToValueAtTime requires a strictly positive target —
    // 0.0001 is the standard near-silent stand-in for "ramp to zero".
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);

    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.15);
  } catch {
    // Never let a feedback failure interfere with capture.
  }
}

/** A short (100ms), unmistakable-but-not-disruptive haptic pulse. */
export function playCaptureVibration(): void {
  try {
    navigator.vibrate?.(100);
  } catch {
    // Never let a feedback failure interfere with capture.
  }
}

export function playCaptureFeedback(): void {
  playCaptureBeep();
  playCaptureVibration();
}

/** Test-only: forces the next playCaptureBeep() call to create a fresh AudioContext. */
export function resetCaptureFeedbackForTests(): void {
  audioContext = null;
}

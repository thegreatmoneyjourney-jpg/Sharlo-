import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  playCaptureBeep,
  playCaptureFeedback,
  playCaptureVibration,
  resetCaptureFeedbackForTests,
} from './capture-feedback';

function installFakeAudioContext() {
  const oscillator = {
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    frequency: { value: 0 },
  };
  const gain = {
    connect: vi.fn(),
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  };
  const ctx = {
    currentTime: 0,
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    destination: {},
  };
  const AudioContextMock = vi.fn(function (this: unknown) {
    return ctx;
  });
  (window as unknown as { AudioContext: unknown }).AudioContext = AudioContextMock;
  return { AudioContextMock, ctx, oscillator, gain };
}

const originalAudioContext = window.AudioContext;
const originalVibrate = navigator.vibrate;

beforeEach(() => {
  resetCaptureFeedbackForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  (window as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
  Object.defineProperty(navigator, 'vibrate', { value: originalVibrate, configurable: true });
});

describe('playCaptureBeep', () => {
  it('creates an oscillator against the audio context and starts/stops it', () => {
    const { ctx, oscillator, gain } = installFakeAudioContext();

    playCaptureBeep();

    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    expect(oscillator.connect).toHaveBeenCalledWith(gain);
    expect(oscillator.start).toHaveBeenCalledTimes(1);
    expect(oscillator.stop).toHaveBeenCalledTimes(1);
  });

  it('reuses the same AudioContext across multiple calls instead of constructing a new one each time', () => {
    const { AudioContextMock } = installFakeAudioContext();

    playCaptureBeep();
    playCaptureBeep();
    playCaptureBeep();

    expect(AudioContextMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when AudioContext is unavailable (e.g. an older/restricted browser)', () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = undefined;
    expect(() => playCaptureBeep()).not.toThrow();
  });

  it('does not throw and does not propagate an error if the Web Audio API itself throws', () => {
    installFakeAudioContext();
    (window.AudioContext as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('blocked by autoplay policy');
    });
    expect(() => playCaptureBeep()).not.toThrow();
  });
});

describe('playCaptureVibration', () => {
  it('calls navigator.vibrate with a short pulse when available', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });

    playCaptureVibration();

    expect(vibrate).toHaveBeenCalledWith(100);
  });

  it('does not throw when navigator.vibrate is unavailable — the permanent iOS Safari case', () => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
    expect(() => playCaptureVibration()).not.toThrow();
  });

  it('does not throw if navigator.vibrate itself throws', () => {
    Object.defineProperty(navigator, 'vibrate', {
      value: () => {
        throw new Error('nope');
      },
      configurable: true,
    });
    expect(() => playCaptureVibration()).not.toThrow();
  });
});

describe('playCaptureFeedback', () => {
  it('triggers both the beep and the vibration', () => {
    const { ctx } = installFakeAudioContext();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });

    playCaptureFeedback();

    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(100);
  });
});

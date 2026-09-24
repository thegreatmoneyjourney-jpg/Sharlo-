import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOpenCvLoadStatus, loadOpenCv, resetOpenCvLoaderForTests } from './opencv-loader';

type WindowWithCv = typeof window & { cv?: unknown };

/**
 * Simulates the browser fetching and executing the injected <script> tag:
 * runs `setup()` (standing in for the script's own top-level code, which
 * sets `window.cv`) and then fires the element's `load` handler — exactly
 * as opencv-loader.ts's `loadScript()` expects. jsdom doesn't actually
 * fetch `src`, so this is the seam that lets the loader's own logic be
 * tested without a real network request or the real 11MB asset.
 */
function mockNextScriptLoad(setup: () => void) {
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementationOnce((tagName: string) => {
    const el = original(tagName) as HTMLScriptElement;
    queueMicrotask(() => {
      setup();
      el.onload?.(new Event('load'));
    });
    return el;
  });
}

function mockNextScriptError() {
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementationOnce((tagName: string) => {
    const el = original(tagName) as HTMLScriptElement;
    queueMicrotask(() => el.onerror?.(new Event('error')));
    return el;
  });
}

/**
 * A `cv` object shaped like the real emscripten Module: a settable
 * `onRuntimeInitialized` (fires on a later macrotask, mirroring WASM
 * instantiation still being in flight when `onload` fires) AND its own
 * `then()` method that resolves itself with itself — the real package
 * supports `Module.then(cv => ...)` usage this way.
 *
 * `then()` is intentionally call-count-bounded rather than genuinely
 * infinite: real emscripten's self-resolving `then()` is exactly what
 * makes it unsafe to ever `return`/`resolve()` a bare `cv` through a
 * Promise (see OpenCvHandle in opencv-loader.ts) — doing so recurses
 * forever via the engine's thenable-resolution check and pins the main
 * thread (this was measured directly: 100%+ CPU, never recovers). A
 * regression test needs that same shape to actually catch a regression,
 * but a truly infinite `then()` would hang this test (and CI) forever
 * instead of failing it, since the resulting microtask storm starves the
 * event loop before Vitest's own timeout (a macrotask) ever gets to fire.
 * Throwing after a few calls turns a would-be-infinite hang into a fast,
 * clearly-diagnosed failure instead.
 */
function makeCallbackStyleCv(getBuildInformation: () => string) {
  let handler: (() => void) | undefined;
  let thenCallCount = 0;
  const cv = {
    getBuildInformation,
    set onRuntimeInitialized(fn: () => void) {
      handler = fn;
      setTimeout(() => handler?.(), 0);
    },
    get onRuntimeInitialized() {
      return handler as unknown as () => void;
    },
    then: vi.fn((resolve: (v: unknown) => void) => {
      thenCallCount += 1;
      if (thenCallCount > 3) {
        throw new Error(
          'cv.then() called more than 3 times — this means something resolved a ' +
            'Promise directly with the bare cv value (e.g. `return cv` from an async ' +
            'function), triggering the self-referential-thenable hang opencv-loader.ts ' +
            'works around by always wrapping as { cv }. See OpenCvHandle.',
        );
      }
      resolve(cv);
    }),
  };
  return cv;
}

describe('loadOpenCv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as WindowWithCv).cv;
    resetOpenCvLoaderForTests();
  });

  it('resolves with { cv } when the global cv is a ready Promise', async () => {
    const cv = { getBuildInformation: () => 'promise-style' };
    mockNextScriptLoad(() => {
      (window as WindowWithCv).cv = Promise.resolve(cv);
    });

    const { cv: result } = await loadOpenCv();

    expect(result.getBuildInformation()).toBe('promise-style');
  });

  it('resolves with { cv } when the global cv is a Module object with onRuntimeInitialized, and never calls cv.then()', async () => {
    const cv = makeCallbackStyleCv(() => 'callback-style');
    mockNextScriptLoad(() => {
      (window as WindowWithCv).cv = cv;
    });

    const { cv: result } = await loadOpenCv();

    expect(result.getBuildInformation()).toBe('callback-style');
    // The regression this guards against: loadOpenCv() must never resolve
    // a Promise with the bare `cv` value anywhere internally, or the
    // engine's own thenable check would invoke this at least once.
    expect(cv.then).not.toHaveBeenCalled();
  });

  it('injects the script only once across repeated and concurrent calls', async () => {
    const cv = { getBuildInformation: () => 'cached' };
    mockNextScriptLoad(() => {
      (window as WindowWithCv).cv = Promise.resolve(cv);
    });

    const [first, second] = await Promise.all([loadOpenCv(), loadOpenCv()]);
    const third = await loadOpenCv();

    expect(first.cv).toBe(second.cv);
    expect(second.cv).toBe(third.cv);
    // mockImplementationOnce only intercepts a single createElement call;
    // if loadOpenCv() had injected a second <script>, this second call
    // would fall through to the real (unmocked) createElement and this
    // assertion setup would have needed a second mock — it didn't, which
    // itself proves only one script tag was ever created.
  });

  it('does not cache a failed load: state resets to idle so a later call can retry', async () => {
    mockNextScriptError();

    expect(getOpenCvLoadStatus()).toBe('idle');
    await expect(loadOpenCv()).rejects.toThrow('Failed to load script');
    expect(getOpenCvLoadStatus()).toBe('idle');
  });
});

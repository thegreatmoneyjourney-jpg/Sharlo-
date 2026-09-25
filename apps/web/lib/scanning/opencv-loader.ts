/**
 * Lazy loader for OpenCV.js (WASM).
 *
 * Loaded via a plain, dynamically-injected `<script>` tag pointing at
 * `/vendor/opencv.js` (copied from `@techstark/opencv-js` into `public/`
 * by `scripts/copy-opencv-asset.mjs`, run on `predev`/`prebuild`) —
 * deliberately NOT via a bundler `import()`. Measured directly: a
 * Turbopack-bundled dynamic `import()` of this ~11MB legacy emscripten UMD
 * build took over two minutes of pinned CPU in a real browser and never
 * finished, while loading the exact same file via a `<script>` tag (how
 * the emscripten build is actually designed to be loaded) reaches
 * `onRuntimeInitialized` in ~1.5s. Bundlers wrap and reprocess a module's
 * source for their own dependency graph; a `<script>` tag just hands the
 * file to the browser as-is, which is what this particular build needs.
 *
 * Every caller in this app MUST go through `loadOpenCv()` below — this
 * function is the only place that injects the script tag, which is what
 * keeps it out of every route that never calls it (marketing pages, in
 * particular) and defers loading until a caller actually needs it
 * (NFR-PERF-02).
 */

const OPENCV_SCRIPT_SRC = '/vendor/opencv.js';

/**
 * Minimal, hand-typed surface of the loaded OpenCV runtime. Deliberately
 * not the full upstream API surface — the package's own README notes its
 * bundled type declarations can lag the actual WASM build. Detection code
 * (M1-003 onward) should widen this as it starts depending on specific
 * cv.* members, rather than trusting the upstream types wholesale.
 */
export interface OpenCvRuntime {
  getBuildInformation: () => string;
  [key: string]: unknown;
}

/**
 * Wrapper around the loaded runtime. NEVER unwrap this by `return`ing or
 * `resolve()`-ing the bare `cv` value from any Promise/async-function
 * boundary — the emscripten Module object has its own `.then()` method
 * (so callers can do `Module.then(cv => ...)`), and that `.then()`
 * resolves itself with the *same* Module object. If a Promise anywhere
 * in this chain ever resolves directly with `cv` as the value, the
 * engine's spec-mandated thenable-resolution check sees `cv.then` and
 * calls it, which calls back with `cv` again, forever — an infinite,
 * self-referential microtask loop that pins the main thread (measured:
 * 100%+ CPU, never recovers). Always pass `cv` wrapped in an object like
 * this one, and only read `.cv` synchronously inside a `.then()` body,
 * never `return` it bare through another promise.
 */
export interface OpenCvHandle {
  cv: OpenCvRuntime;
}

type LoaderState =
  | { status: 'idle' }
  | { status: 'loading'; promise: Promise<OpenCvHandle> }
  | { status: 'ready'; cv: OpenCvRuntime };

let state: LoaderState = { status: 'idle' };

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

async function loadAndAwaitRuntime(): Promise<OpenCvHandle> {
  await loadScript(OPENCV_SCRIPT_SRC);

  // The script attaches its export as a global `cv` — either a Promise
  // that resolves once WASM is ready, or a Module-like object that
  // invokes `onRuntimeInitialized` when ready, depending on the build.
  // Handle both, per the package's own documented usage pattern. See
  // OpenCvHandle's doc comment for why this always returns `{ cv }`,
  // never bare `cv`.
  const globalCv: unknown = (window as unknown as { cv?: unknown }).cv;

  if (globalCv instanceof Promise) {
    const cv = (await globalCv) as OpenCvRuntime;
    return { cv };
  }

  const cv = globalCv as OpenCvRuntime & { onRuntimeInitialized?: () => void };
  await new Promise<void>((resolve) => {
    cv.onRuntimeInitialized = () => resolve();
  });
  return { cv };
}

/**
 * Loads OpenCV.js, injecting the script tag on first call only.
 * Concurrent and subsequent calls reuse the in-flight promise or the
 * cached instance — never re-inject the script or re-instantiate WASM.
 *
 * Resolves with `{ cv }`, not `cv` directly — see `OpenCvHandle`'s doc
 * comment before "simplifying" this to resolve with `cv` itself.
 *
 * A failed load is not cached: the state resets to `idle` so the next
 * call retries fresh (e.g. after a transient network error), rather than
 * sticking in a permanently-failed state.
 */
export function loadOpenCv(): Promise<OpenCvHandle> {
  if (state.status === 'ready') {
    return Promise.resolve({ cv: state.cv });
  }
  if (state.status === 'loading') {
    return state.promise;
  }

  const promise = loadAndAwaitRuntime()
    .then((handle) => {
      state = { status: 'ready', cv: handle.cv };
      return handle;
    })
    .catch((error: unknown) => {
      state = { status: 'idle' };
      throw error;
    });

  state = { status: 'loading', promise };
  return promise;
}

/** Current phase, without triggering a load — lets UI code read state synchronously. */
export function getOpenCvLoadStatus(): LoaderState['status'] {
  return state.status;
}

/** Test-only: reset the module-level cache between test cases. */
export function resetOpenCvLoaderForTests(): void {
  state = { status: 'idle' };
}

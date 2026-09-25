/**
 * Polyfills `Map.prototype.getOrInsertComputed`/`getOrInsert` (the TC39
 * "Upsert" proposal) for the main-thread side of pdfjs-dist
 * (`build/pdf.mjs`, imported by `load-pdf-file.ts`). Not yet available in
 * every browser engine as of this writing — reproduced directly against
 * both a real, fairly current Chromium (141, Playwright 1.56.1's bundled
 * build) and Node 22 while building the M2-009 detection-harness
 * verification, neither of which has it — and pdfjs-dist has called it
 * unconditionally, with no feature-detection or fallback of its own,
 * since at least v5.7. Without this, `getDocument()`/`page.render()`
 * throws immediately (`TypeError: ...getOrInsertComputed is not a
 * function`) on any such browser — see docs/reports/SHARLO-M2-009.md.
 *
 * pdfjs-dist's own *worker* script needs the exact same polyfill, but as
 * a separate realm (a module Worker has its own global `Map`, untouched
 * by anything patched here on the main thread) it can't reuse this
 * module directly — see `public/pdf-worker-shim.mjs`, which every code
 * comment here should stay in sync with.
 */
export function installMapUpsertPolyfill(): void {
  const proto = Map.prototype as Map<unknown, unknown> & {
    getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown;
    getOrInsert?: (key: unknown, value: unknown) => unknown;
  };

  if (!proto.getOrInsertComputed) {
    proto.getOrInsertComputed = function (
      this: Map<unknown, unknown>,
      key: unknown,
      callback: (key: unknown) => unknown,
    ) {
      if (!this.has(key)) this.set(key, callback(key));
      return this.get(key);
    };
  }

  if (!proto.getOrInsert) {
    proto.getOrInsert = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (!this.has(key)) this.set(key, value);
      return this.get(key);
    };
  }
}

/**
 * Renders each page of a batch-imported PDF `File` (M2-009 — a
 * multi-page "scan to PDF" export, the common output of a flatbed
 * scanner/MFP when a teacher scans a stack of filled-in bubble sheets)
 * to pixel data for `read-sheet-from-image.ts`'s `detectAndReadSheet`,
 * one page at a time — mirroring `load-image-file.ts`'s `LoadedImageFile`
 * shape (`imageUrl`/`width`/`height`/`imageData`) so the M2-009
 * batch-import loop can treat "one uploaded image" and "one page of an
 * uploaded PDF" identically once loaded.
 *
 * `loadPage` is exposed one-page-at-a-time (`numPages` up front, then a
 * `loadPage(n)` the caller drives) rather than eagerly rendering every
 * page, both so the batch-import UI can show real "processing page N of
 * M" progress and so a large PDF never holds every page's full-resolution
 * `ImageData` in memory at once.
 *
 * Uses `pdfjs-dist` (Mozilla's PDF.js, pinned exact version — see
 * `package.json`). Its worker script, predefined Adobe CMaps, and
 * standard-font data are large third-party build assets the *worker*
 * fetches by URL at runtime, not things a bundler import can reach —
 * `scripts/copy-pdfjs-assets.mjs` copies them into `public/vendor/` on
 * `predev`/`prebuild`, the same "copy into public/, load by URL, don't
 * make a bundler process it" approach `opencv-loader.ts` uses for
 * OpenCV.js and for the identical reason (these are pre-built vendor
 * assets meant to be fetched as-is, not bundled).
 *
 * `useWasm: false`: without also copying pdfjs's `wasm/` asset directory
 * and wiring a `wasmUrl` (not done here — see docs/reports/
 * SHARLO-M2-009.md's Flags), a PDF page containing a JBIG2- or
 * JPEG2000-compressed image would otherwise throw
 * ("`BinaryDataFactory` not initialized") the moment pdfjs tried to
 * fetch the wasm codec for it — a real risk here, not a contrived one:
 * JBIG2 in particular is a common default for "black & white scan to
 * PDF" on real scanner/MFP hardware, which is exactly the kind of file
 * this loader exists to accept. Forcing `useWasm: false` makes pdfjs use
 * its documented pure-JS decode fallback for those codecs instead
 * (`*_nowasm_fallback.js`, shipped in the same package) — slower than
 * native-speed WASM decode, which doesn't matter at batch-import scale,
 * but it decodes correctly rather than throwing.
 *
 * `WORKER_SRC` points at `public/pdf-worker-shim.mjs`, not pdfjs's own
 * worker file directly — see that file and `map-upsert-polyfill.ts` for
 * why: pdfjs-dist calls `Map.prototype.getOrInsertComputed` (main thread
 * *and* worker) with no feature-detection, which isn't yet available in
 * every browser engine as of this writing (confirmed missing in both a
 * current Chromium and Node 22 while building this — see docs/reports/
 * SHARLO-M2-009.md) and throws immediately without the polyfill.
 */

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { installMapUpsertPolyfill } from './map-upsert-polyfill';

const MAX_DIMENSION_PX = 1920;

const WORKER_SRC = '/pdf-worker-shim.mjs';
const CMAP_URL = '/vendor/pdfjs/cmaps/';
const STANDARD_FONT_DATA_URL = '/vendor/pdfjs/standard_fonts/';

let workerConfigured = false;

function ensureWorkerConfigured(): void {
  if (workerConfigured) return;
  installMapUpsertPolyfill();
  GlobalWorkerOptions.workerSrc = WORKER_SRC;
  workerConfigured = true;
}

export interface LoadedPdfPage {
  pageNumber: number;
  imageUrl: string;
  width: number;
  height: number;
  imageData: ImageData;
}

export interface LoadedPdfDocument {
  numPages: number;
  loadPage(pageNumber: number): Promise<LoadedPdfPage>;
}

async function renderPage(doc: PDFDocumentProxy, pageNumber: number): Promise<LoadedPdfPage> {
  const page = await doc.getPage(pageNumber);

  // A PDF page's default viewport is sized in points (1/72in — e.g. a
  // Letter page is only 612x792 at scale 1), far below the read
  // pipeline's target resolution, so — unlike `load-image-file.ts`,
  // which only ever downscales an already-high-resolution photo — this
  // always scales *to* the target, up or down, never clamped to `<= 1`.
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = MAX_DIMENSION_PX / Math.max(baseViewport.width, baseViewport.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  await page.render({ canvas, viewport }).promise;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const imageUrl = canvas.toDataURL('image/jpeg', 0.92);
  return { pageNumber, imageUrl, width: canvas.width, height: canvas.height, imageData };
}

export async function loadPdfDocument(file: File): Promise<LoadedPdfDocument> {
  ensureWorkerConfigured();
  const data = await file.arrayBuffer();
  const doc = await getDocument({
    data,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    useWasm: false,
  }).promise;

  return {
    numPages: doc.numPages,
    loadPage: (pageNumber: number) => renderPage(doc, pageNumber),
  };
}

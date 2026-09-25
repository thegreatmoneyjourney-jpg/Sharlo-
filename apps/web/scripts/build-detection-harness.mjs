// Builds the detection-engine test harness's browser bundle (M1-010) —
// copies OpenCV.js and esbuild-bundles browser-entry.ts into
// tests/detection-harness/.generated/, which serve-detection-harness.mjs
// serves and harness.html loads from. Not committed to git, same
// reasoning as copy-opencv-asset.mjs: fully reproducible from source on
// every install/CI run, so there's nothing to keep in sync by hand.
//
// M2-009: also copies the pdfjs-dist assets `lib/scanning/
// load-pdf-file.ts` fetches by URL at runtime (its worker script, plus
// the predefined CMap/standard-font data), same reasoning as
// copy-pdfjs-assets.mjs — into .generated/vendor/pdfjs/, which
// serve-detection-harness.mjs rewrites that file's hardcoded
// /vendor/pdfjs/* request paths to, so the bundled browser-entry.ts can
// exercise the exact same production loadPdfDocument() this harness
// doesn't reimplement.
import { build } from 'esbuild';
import { copyFile, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const harnessDir = path.join(webRoot, 'tests/detection-harness');
const outDir = path.join(harnessDir, '.generated');

await mkdir(outDir, { recursive: true });

// Resolved rather than a fixed relative path — see copy-opencv-asset.mjs's
// own comment: npm workspaces hoist this package to the repo-root
// node_modules, not apps/web/node_modules.
const opencvSource = fileURLToPath(import.meta.resolve('@techstark/opencv-js'));
await copyFile(opencvSource, path.join(outDir, 'opencv.js'));

const pdfjsRoot = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
const pdfjsOutDir = path.join(outDir, 'vendor/pdfjs');
await mkdir(pdfjsOutDir, { recursive: true });
await copyFile(
  path.join(pdfjsRoot, 'build/pdf.worker.min.mjs'),
  path.join(pdfjsOutDir, 'pdf.worker.min.mjs'),
);
await cp(path.join(pdfjsRoot, 'cmaps'), path.join(pdfjsOutDir, 'cmaps'), { recursive: true });
await cp(path.join(pdfjsRoot, 'standard_fonts'), path.join(pdfjsOutDir, 'standard_fonts'), {
  recursive: true,
});

// The committed shim (see public/pdf-worker-shim.mjs's own doc comment)
// that patches the not-yet-universally-supported Map upsert methods
// pdfjs-dist's worker calls unconditionally, before loading the real
// worker — load-pdf-file.ts points GlobalWorkerOptions.workerSrc at it
// rather than the worker file directly, so this harness needs its own
// servable copy too, exactly like the real app's public/ directory
// already provides one.
await copyFile(
  path.join(webRoot, 'public/pdf-worker-shim.mjs'),
  path.join(outDir, 'pdf-worker-shim.mjs'),
);

await build({
  entryPoints: [path.join(harnessDir, 'browser-entry.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: path.join(outDir, 'harness-bundle.js'),
});

console.log('Built detection harness into tests/detection-harness/.generated/');

// Builds the detection-engine test harness's browser bundle (M1-010) —
// copies OpenCV.js and esbuild-bundles browser-entry.ts into
// tests/detection-harness/.generated/, which serve-detection-harness.mjs
// serves and harness.html loads from. Not committed to git, same
// reasoning as copy-opencv-asset.mjs: fully reproducible from source on
// every install/CI run, so there's nothing to keep in sync by hand.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
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

await build({
  entryPoints: [path.join(harnessDir, 'browser-entry.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: path.join(outDir, 'harness-bundle.js'),
});

console.log('Built detection harness into tests/detection-harness/.generated/');

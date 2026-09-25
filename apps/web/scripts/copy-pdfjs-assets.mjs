// Copies the pdfjs-dist build assets `lib/scanning/load-pdf-file.ts`
// needs at runtime into public/vendor/pdfjs/ — same reasoning as
// copy-opencv-asset.mjs: these are pre-built third-party files the
// pdf.js *worker* fetches by plain URL at runtime (the worker script
// itself, plus the predefined CMap and standard-font data it fetches
// for pages with embedded/non-embedded text), not something a bundler
// import can reach. Not committed to git — regenerated from the pinned
// npm dependency on every install, same as any other build output.
import { copyFile, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Resolved rather than a fixed relative path — see copy-opencv-asset.mjs's
// own comment: npm workspaces hoist this package to the repo-root
// node_modules, not apps/web/node_modules.
const pkgRoot = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
const destDir = path.join(webRoot, 'public/vendor/pdfjs');

await mkdir(destDir, { recursive: true });

await copyFile(
  path.join(pkgRoot, 'build/pdf.worker.min.mjs'),
  path.join(destDir, 'pdf.worker.min.mjs'),
);
await cp(path.join(pkgRoot, 'cmaps'), path.join(destDir, 'cmaps'), { recursive: true });
await cp(path.join(pkgRoot, 'standard_fonts'), path.join(destDir, 'standard_fonts'), {
  recursive: true,
});

console.log(`Copied pdfjs-dist assets to ${path.relative(webRoot, destDir)}`);

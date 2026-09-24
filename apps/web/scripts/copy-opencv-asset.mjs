// Copies the OpenCV.js build from node_modules into public/vendor/ so
// opencv-loader.ts can load it via a plain <script> tag rather than a
// bundler dynamic import() — see the comment in opencv-loader.ts for why
// (Turbopack-bundled dynamic import of this ~11MB legacy UMD file measured
// as pathologically slow in a real browser; a plain <script> tag, which is
// how the emscripten build is documented/designed to be loaded, does not
// have that problem). Not committed to git — regenerated from the pinned
// npm dependency on every install, same as any other build output.
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Resolved rather than a fixed relative path: npm workspaces hoist this
// package to the repo-root node_modules, not apps/web/node_modules.
const source = fileURLToPath(import.meta.resolve('@techstark/opencv-js'));
const destDir = path.join(webRoot, 'public/vendor');
const dest = path.join(destDir, 'opencv.js');

await mkdir(destDir, { recursive: true });
await copyFile(source, dest);
console.log(`Copied OpenCV.js asset to ${path.relative(webRoot, dest)}`);

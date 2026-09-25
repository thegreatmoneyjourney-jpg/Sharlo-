// Bundles scripts/generate-stock-templates.ts for Node (esbuild, same
// pattern build-detection-harness.mjs already established for the
// browser side) and runs it. Deliberately a manual, deliberate step —
// NOT wired into predev/prebuild — because the output (the stock
// template PDFs + their geometry seed data) must stay stable once
// published: a teacher's already-printed sheet has to keep matching its
// template's geometry forever, so regenerating on every build would risk
// silently changing a live template out from under printed copies. Any
// future change to a stock template's layout is a new schema_version /
// new template, not a rerun of this script overwriting the old one — see
// docs/reports/SHARLO-M2-001.md.
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(webRoot, 'scripts/.generated');
const outFile = path.join(outDir, 'generate-stock-templates.bundle.mjs');

await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(webRoot, 'scripts/generate-stock-templates.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: outFile,
});

const { main } = await import(pathToFileURL(outFile).href);
await main(webRoot);

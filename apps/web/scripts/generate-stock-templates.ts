/**
 * Generates the 3 launch stock-template PDFs (FR-TPL-01) and the seed
 * data M2-002's `templates` table migration will load — bundled and run
 * by `run-generate-stock-templates.mjs` (same esbuild-for-Node pattern
 * `build-detection-harness.mjs` already established for the browser
 * side), not executed as raw TypeScript, so this has no dependency on
 * an experimental Node flag.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  computeStockTemplateGeometry,
  STOCK_TEMPLATE_QUESTION_COUNTS,
} from '../lib/templates/geometry';
import { generateTemplatePdf } from '../lib/templates/generate-pdf';

interface StockTemplateSeedRecord {
  name: string;
  questionCount: number;
  isStock: true;
  schemaVersion: 1;
  geometry: ReturnType<typeof computeStockTemplateGeometry>;
}

export async function main(webRoot: string): Promise<void> {
  const pdfDir = path.join(webRoot, 'public/templates');
  await mkdir(pdfDir, { recursive: true });

  const seedRecords: StockTemplateSeedRecord[] = [];

  for (const questionCount of STOCK_TEMPLATE_QUESTION_COUNTS) {
    const geometry = computeStockTemplateGeometry(questionCount);
    const pdfBytes = await generateTemplatePdf(geometry);

    const pdfPath = path.join(pdfDir, `sharlo-${questionCount}q.pdf`);
    await writeFile(pdfPath, pdfBytes);
    console.log(`Wrote ${path.relative(webRoot, pdfPath)} (${pdfBytes.byteLength} bytes)`);

    seedRecords.push({
      name: `Sharlo ${questionCount}-question answer sheet`,
      questionCount,
      isStock: true,
      schemaVersion: 1,
      geometry,
    });
  }

  const seedPath = path.join(webRoot, 'lib/templates/stock-templates-seed.json');
  await writeFile(seedPath, JSON.stringify(seedRecords, null, 2) + '\n');
  console.log(`Wrote ${path.relative(webRoot, seedPath)}`);
}

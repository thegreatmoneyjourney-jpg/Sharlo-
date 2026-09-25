import { describe, expect, it } from 'vitest';
import { generateTemplatePdf } from './generate-pdf';
import {
  MAX_CUSTOM_OPTIONS_PER_QUESTION,
  MIN_CUSTOM_OPTIONS_PER_QUESTION,
  computeCustomTemplateGeometry,
  computeStockTemplateGeometry,
} from './geometry';

function expectValidPdfBytes(bytes: Uint8Array): void {
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  expect(header).toBe('%PDF-');
}

describe('generateTemplatePdf', () => {
  it('renders a stock template without throwing', async () => {
    const bytes = await generateTemplatePdf(computeStockTemplateGeometry(20));
    expectValidPdfBytes(bytes);
  });

  /**
   * Regression test for a real bug this task found: `OPTION_LETTERS` was
   * hardcoded to exactly 4 entries (A-D), so any custom template with
   * `optionsPerQuestion` outside 4 indexed past the array and would have
   * printed `undefined` as a bubble's label. Covers the full supported
   * range, not just one value, since the bug only manifested above 4.
   */
  it.each(
    Array.from(
      { length: MAX_CUSTOM_OPTIONS_PER_QUESTION - MIN_CUSTOM_OPTIONS_PER_QUESTION + 1 },
      (_, i) => i + MIN_CUSTOM_OPTIONS_PER_QUESTION,
    ),
  )('renders a custom template with %i options per question without throwing', async (options) => {
    const bytes = await generateTemplatePdf(computeCustomTemplateGeometry(10, options));
    expectValidPdfBytes(bytes);
  });
});

import { describe, expect, it } from 'vitest';
import {
  BUBBLE_RADIUS_PT,
  MARKER_SIZE_PT,
  MAX_CUSTOM_OPTIONS_PER_QUESTION,
  MAX_CUSTOM_QUESTION_COUNT,
  MIN_CUSTOM_OPTIONS_PER_QUESTION,
  MIN_CUSTOM_QUESTION_COUNT,
  PAGE_HEIGHT_PT,
  PAGE_WIDTH_PT,
  STOCK_TEMPLATE_QUESTION_COUNTS,
  TemplateLayoutTooDenseError,
  computeCustomTemplateGeometry,
  computeGridLayout,
  computeStockTemplateGeometry,
} from './geometry';
import type { BubbleGeometry, TemplateGeometry } from './geometry';

/**
 * These are the enforcement mechanism for "this geometry is actually
 * printable and legible," not just documentation of intent — same
 * standard `bubble-fill.test.ts`'s "never guesses" suite sets for its
 * own core guarantee. A future change to the layout constants in
 * geometry.ts that makes two bubbles overlap, or pushes one off the
 * page, fails here before it ever reaches a printed PDF.
 */

function allBubbles(geometry: TemplateGeometry): BubbleGeometry[] {
  return [
    ...geometry.questions.flatMap((q) => q.options),
    ...geometry.rollNumberColumns.flatMap((c) => c.options),
  ];
}

function distance(a: BubbleGeometry, b: BubbleGeometry): number {
  return Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
}

describe.each(STOCK_TEMPLATE_QUESTION_COUNTS)(
  'computeStockTemplateGeometry(%i)',
  (questionCount) => {
    const geometry = computeStockTemplateGeometry(questionCount);

    it('produces exactly questionCount questions, each with 4 options (A-D)', () => {
      expect(geometry.questions).toHaveLength(questionCount);
      expect(geometry.questions.map((q) => q.questionNumber)).toEqual(
        Array.from({ length: questionCount }, (_, i) => i + 1),
      );
      for (const question of geometry.questions) {
        expect(question.options.map((o) => o.optionIndex)).toEqual([0, 1, 2, 3]);
      }
    });

    it('produces exactly 6 roll-number columns, each with 10 options (0-9)', () => {
      expect(geometry.rollNumberColumns).toHaveLength(6);
      expect(geometry.rollNumberColumns.map((c) => c.columnIndex)).toEqual([0, 1, 2, 3, 4, 5]);
      for (const column of geometry.rollNumberColumns) {
        expect(column.options.map((o) => o.optionIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      }
    });

    it('places every bubble (answer + roll-number) strictly within the printable page', () => {
      for (const bubble of allBubbles(geometry)) {
        expect(bubble.center.x - BUBBLE_RADIUS_PT).toBeGreaterThan(0);
        expect(bubble.center.x + BUBBLE_RADIUS_PT).toBeLessThan(PAGE_WIDTH_PT);
        expect(bubble.center.y - BUBBLE_RADIUS_PT).toBeGreaterThan(0);
        expect(bubble.center.y + BUBBLE_RADIUS_PT).toBeLessThan(PAGE_HEIGHT_PT);
      }
    });

    it('never overlaps two bubbles, and leaves a real visible gap between any two adjacent ones', () => {
      // A pure ">= 2x radius" check would let two bubbles print exactly
      // tangent (touching, zero visual gap) — not actually overlapping,
      // but not legibly separated on paper either, and right at the edge
      // of floating-point noise besides. Requiring a real (2.1x) margin
      // catches "touching" as the design smell it is, not just literal
      // pixel overlap.
      const bubbles = allBubbles(geometry);
      const minAllowedDistance = BUBBLE_RADIUS_PT * 2.1;
      for (let i = 0; i < bubbles.length; i++) {
        for (let j = i + 1; j < bubbles.length; j++) {
          expect(distance(bubbles[i], bubbles[j])).toBeGreaterThanOrEqual(minAllowedDistance);
        }
      }
    });

    it('is a pure function — calling it twice produces identical geometry', () => {
      expect(computeStockTemplateGeometry(questionCount)).toEqual(
        computeStockTemplateGeometry(questionCount),
      );
    });
  },
);

describe('corner markers', () => {
  it('places all 4 markers at distinct corners, fully on the page, in a consistent, non-degenerate rectangle', () => {
    const geometry = computeStockTemplateGeometry(20);
    const { topLeft, topRight, bottomLeft, bottomRight } = geometry.markers;

    expect(topLeft.x).toBeLessThan(topRight.x);
    expect(bottomLeft.x).toBeLessThan(bottomRight.x);
    expect(topLeft.y).toBeLessThan(bottomLeft.y);
    expect(topRight.y).toBeLessThan(bottomRight.y);

    for (const marker of [topLeft, topRight, bottomLeft, bottomRight]) {
      expect(marker.x - MARKER_SIZE_PT / 2).toBeGreaterThan(0);
      expect(marker.x + MARKER_SIZE_PT / 2).toBeLessThan(PAGE_WIDTH_PT);
      expect(marker.y - MARKER_SIZE_PT / 2).toBeGreaterThan(0);
      expect(marker.y + MARKER_SIZE_PT / 2).toBeLessThan(PAGE_HEIGHT_PT);
    }
  });

  it('is identical across every stock question-count variant — only the answer grid changes', () => {
    const markerSets = STOCK_TEMPLATE_QUESTION_COUNTS.map(
      (count) => computeStockTemplateGeometry(count).markers,
    );
    for (const markers of markerSets.slice(1)) {
      expect(markers).toEqual(markerSets[0]);
    }
  });
});

describe('computeGridLayout', () => {
  it("reproduces the stock table's exact {columns, rows} for 20/50/100 — proof the two independently-defined layout paths agree, not that one calls the other", () => {
    expect(computeGridLayout(20)).toEqual({ columns: 1, rows: 20 });
    expect(computeGridLayout(50)).toEqual({ columns: 2, rows: 25 });
    expect(computeGridLayout(100)).toEqual({ columns: 4, rows: 25 });
  });

  it('caps rows at 25 and grows columns for larger counts', () => {
    expect(computeGridLayout(1)).toEqual({ columns: 1, rows: 1 });
    expect(computeGridLayout(35)).toEqual({ columns: 2, rows: 25 });
    expect(computeGridLayout(26)).toEqual({ columns: 2, rows: 25 });
  });
});

describe.each([
  { questionCount: 1, optionsPerQuestion: 2 },
  { questionCount: 15, optionsPerQuestion: 4 },
  { questionCount: 35, optionsPerQuestion: 5 },
  { questionCount: 73, optionsPerQuestion: 4 },
  { questionCount: 100, optionsPerQuestion: 3 },
])('computeCustomTemplateGeometry(%o)', ({ questionCount, optionsPerQuestion }) => {
  const geometry = computeCustomTemplateGeometry(questionCount, optionsPerQuestion);

  it('produces exactly questionCount questions, each with optionsPerQuestion options', () => {
    expect(geometry.questions).toHaveLength(questionCount);
    expect(geometry.questions.map((q) => q.questionNumber)).toEqual(
      Array.from({ length: questionCount }, (_, i) => i + 1),
    );
    for (const question of geometry.questions) {
      expect(question.options).toHaveLength(optionsPerQuestion);
      expect(question.options.map((o) => o.optionIndex)).toEqual(
        Array.from({ length: optionsPerQuestion }, (_, i) => i),
      );
    }
  });

  it('places every bubble (answer + roll-number) strictly within the printable page', () => {
    for (const bubble of allBubbles(geometry)) {
      expect(bubble.center.x - BUBBLE_RADIUS_PT).toBeGreaterThan(0);
      expect(bubble.center.x + BUBBLE_RADIUS_PT).toBeLessThan(PAGE_WIDTH_PT);
      expect(bubble.center.y - BUBBLE_RADIUS_PT).toBeGreaterThan(0);
      expect(bubble.center.y + BUBBLE_RADIUS_PT).toBeLessThan(PAGE_HEIGHT_PT);
    }
  });

  it('never overlaps two bubbles, and leaves a real visible gap between any two adjacent ones', () => {
    const bubbles = allBubbles(geometry);
    const minAllowedDistance = BUBBLE_RADIUS_PT * 2.1;
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        expect(distance(bubbles[i], bubbles[j])).toBeGreaterThanOrEqual(minAllowedDistance);
      }
    }
  });

  it('uses the same marker positions as every stock variant', () => {
    expect(geometry.markers).toEqual(computeStockTemplateGeometry(20).markers);
  });

  it('is a pure function — calling it twice produces identical geometry', () => {
    expect(computeCustomTemplateGeometry(questionCount, optionsPerQuestion)).toEqual(geometry);
  });
});

describe('computeCustomTemplateGeometry validation', () => {
  it('throws on a non-integer, zero, negative, or out-of-range questionCount', () => {
    expect(() => computeCustomTemplateGeometry(0)).toThrow();
    expect(() => computeCustomTemplateGeometry(-5)).toThrow();
    expect(() => computeCustomTemplateGeometry(2.5)).toThrow();
    expect(() => computeCustomTemplateGeometry(MAX_CUSTOM_QUESTION_COUNT + 1)).toThrow();
    expect(() => computeCustomTemplateGeometry(MIN_CUSTOM_QUESTION_COUNT - 1)).toThrow();
  });

  it('throws on a non-integer or out-of-range optionsPerQuestion', () => {
    expect(() => computeCustomTemplateGeometry(20, 1)).toThrow();
    expect(() => computeCustomTemplateGeometry(20, 2.5)).toThrow();
    expect(() => computeCustomTemplateGeometry(20, MAX_CUSTOM_OPTIONS_PER_QUESTION + 1)).toThrow();
    expect(() => computeCustomTemplateGeometry(20, MIN_CUSTOM_OPTIONS_PER_QUESTION - 1)).toThrow();
  });

  it('throws TemplateLayoutTooDenseError (not a generic error, and never a silently-broken PDF) when the combination cannot fit legibly on one page', () => {
    // Mirrors M2-001's real tangent-bubble bug: this guard exists so an
    // overly-ambitious custom template fails loudly at generation time
    // instead of producing overlapping bubbles on a printed page.
    expect(() => computeCustomTemplateGeometry(500, 8)).toThrow(TemplateLayoutTooDenseError);
    expect(() => computeCustomTemplateGeometry(200, 6)).toThrow(TemplateLayoutTooDenseError);
  });
});

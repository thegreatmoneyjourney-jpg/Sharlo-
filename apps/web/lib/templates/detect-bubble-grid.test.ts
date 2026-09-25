import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, clusterCirclesIntoGrid } from './detect-bubble-grid';
import type { DetectedCircle } from './detect-bubble-grid';

function buildGrid(rows: number, columns: number, opts: { cellW?: number; cellH?: number } = {}) {
  const cellW = opts.cellW ?? 20;
  const cellH = opts.cellH ?? 24;
  const circles: DetectedCircle[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      circles.push({ x: c * cellW + 10, y: r * cellH + 10, radius: 6 });
    }
  }
  return circles;
}

describe('clusterCirclesIntoGrid', () => {
  it('recovers a clean uniform grid confidently', () => {
    const circles = buildGrid(6, 4);
    expect(clusterCirclesIntoGrid(circles)).toEqual({ rows: 6, columns: 4, confident: true });
  });

  it('recovers a larger, denser grid confidently', () => {
    const circles = buildGrid(25, 2, { cellW: 22, cellH: 14 });
    expect(clusterCirclesIntoGrid(circles)).toEqual({ rows: 25, columns: 2, confident: true });
  });

  it('falls back to the default grid on no detected circles', () => {
    expect(clusterCirclesIntoGrid([])).toEqual(DEFAULT_GRID);
  });

  it('falls back to the default grid when too few rows are found', () => {
    // Only 2 rows -- below MIN_CONFIDENT_ROWS, however clean the data.
    const circles = buildGrid(2, 4);
    expect(clusterCirclesIntoGrid(circles)).toEqual(DEFAULT_GRID);
  });

  it('falls back to the default grid when only 1 column is found', () => {
    const circles = buildGrid(10, 1);
    expect(clusterCirclesIntoGrid(circles)).toEqual(DEFAULT_GRID);
  });

  it('tolerates one row with a missing bubble (still meets the consistency ratio)', () => {
    // 6 rows of 4, minus one bubble in a single row -> 5/6 rows at the
    // modal size (~83%), comfortably above the 70% consistency bar.
    const circles = buildGrid(6, 4).filter((c) => !(c.y === 0 * 24 + 10 && c.x === 3 * 20 + 10));
    expect(clusterCirclesIntoGrid(circles)).toEqual({ rows: 6, columns: 4, confident: true });
  });

  it('falls back to the default grid on a genuinely ragged, inconsistent detection', () => {
    // Row sizes all different (1, 2, 3, 4, 5) -- no size reaches the 70%
    // consistency bar, so this should never be reported as a confident grid.
    const circles: DetectedCircle[] = [];
    let y = 0;
    for (const rowLen of [1, 2, 3, 4, 5]) {
      for (let c = 0; c < rowLen; c++) circles.push({ x: c * 20 + 10, y: y + 10, radius: 6 });
      y += 24;
    }
    expect(clusterCirclesIntoGrid(circles)).toEqual(DEFAULT_GRID);
  });

  it('separates rows correctly based on the typical (median) detected radius, not a fixed pixel gap', () => {
    // Larger bubbles (radius 15) need a proportionally larger row gap to
    // separate correctly -- row pitch of 40px, radius 15 -> gap threshold
    // 22.5px, well under the 40px row pitch, so rows must still separate.
    const circles = buildGrid(4, 3, { cellW: 50, cellH: 40 }).map((c) => ({ ...c, radius: 15 }));
    expect(clusterCirclesIntoGrid(circles)).toEqual({ rows: 4, columns: 3, confident: true });
  });
});

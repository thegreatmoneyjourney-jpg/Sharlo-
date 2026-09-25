import { describe, expect, it } from 'vitest';
import { orderQuadrilateralCorners } from './detect-sheet-boundary';
import type { Point } from '../scanning/corner-markers';

describe('orderQuadrilateralCorners', () => {
  it('orders an already-upright square correctly', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(orderQuadrilateralCorners(points)).toEqual({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    });
  });

  it('orders correctly regardless of input winding/starting point', () => {
    // Same square, but listed starting from bottomRight and going
    // counter-clockwise -- approxPolyDP/minAreaRect give no guarantee
    // about starting point or winding direction, so this must not matter.
    const points: Point[] = [
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(orderQuadrilateralCorners(points)).toEqual({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    });
  });

  it('orders a rotated (in-plane) quadrilateral correctly', () => {
    // The same square rotated ~8 degrees about its center (200,150) --
    // mirrors the "rotated-8deg-clean" scratchpad probe scenario that
    // validated the underlying detection algorithm.
    const points: Point[] = [
      { x: 110.55, y: -3.95 },
      { x: 328.41, y: 26.67 },
      { x: 289.45, y: 303.95 },
      { x: 71.59, y: 273.33 },
    ];
    const ordered = orderQuadrilateralCorners(points);
    expect(ordered.topLeft.x).toBeCloseTo(110.55, 1);
    expect(ordered.topRight.x).toBeCloseTo(328.41, 1);
    expect(ordered.bottomRight.x).toBeCloseTo(289.45, 1);
    expect(ordered.bottomLeft.x).toBeCloseTo(71.59, 1);
  });

  it('orders a perspective-distorted trapezoid correctly (top edge foreshortened)', () => {
    // Mirrors the scratchpad probe's "perspective-trapezoid" scenario --
    // a real phone photo of a sheet is foreshortened, not just rotated.
    const points: Point[] = [
      { x: 130, y: 40 },
      { x: 290, y: 55 },
      { x: 310, y: 270 },
      { x: 80, y: 260 },
    ];
    expect(orderQuadrilateralCorners(points)).toEqual({
      topLeft: { x: 130, y: 40 },
      topRight: { x: 290, y: 55 },
      bottomRight: { x: 310, y: 270 },
      bottomLeft: { x: 80, y: 260 },
    });
  });

  it('throws rather than guessing when given the wrong number of points', () => {
    expect(() => orderQuadrilateralCorners([{ x: 0, y: 0 }])).toThrow();
    expect(() =>
      orderQuadrilateralCorners([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 0.5, y: 0.5 },
      ]),
    ).toThrow();
  });
});

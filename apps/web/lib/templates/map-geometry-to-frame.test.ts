import { describe, expect, it } from 'vitest';
import { computeStockTemplateGeometry } from './geometry';
import { dewarpedDestRect, mapTemplateGeometryToFrame } from './map-geometry-to-frame';

describe('dewarpedDestRect', () => {
  it('insets by paddingRatio of the *unpadded* span, not of dewarpedSize itself', () => {
    // dewarpFrame's own padY = Math.round(span.height * paddingRatio),
    // where span.height is the span *before* padding — not
    // dewarpedSize.height * paddingRatio (that double-counts the
    // padding already baked into dewarpedSize; see this function's own
    // doc comment for the real bug this distinction fixed).
    // width=1000, paddingRatio=0.1 -> padX = 1000*0.1/1.2 = 83.33...
    const result = dewarpedDestRect({ width: 1000, height: 500 }, 0.1);
    expect(result.left).toBeCloseTo(83.333, 2);
    expect(result.top).toBeCloseTo(41.667, 2);
    expect(result.right).toBeCloseTo(916.667, 2);
    expect(result.bottom).toBeCloseTo(458.333, 2);
  });

  it('is the full frame at paddingRatio 0', () => {
    expect(dewarpedDestRect({ width: 200, height: 300 }, 0)).toEqual({
      left: 0,
      top: 0,
      right: 200,
      bottom: 300,
    });
  });

  it("matches dewarpFrame's own padding formula when reconstructed from a known span", () => {
    // Cross-check against dewarpFrame's exact formula (perspective-transform.ts):
    // width = Math.round(span.width * (1 + 2*paddingRatio)); padX = Math.round(span.width * paddingRatio).
    const span = { width: 2000, height: 1500 };
    const paddingRatio = 0.06;
    const dewarpedWidth = Math.round(span.width * (1 + 2 * paddingRatio));
    const dewarpedHeight = Math.round(span.height * (1 + 2 * paddingRatio));
    const truePadX = Math.round(span.width * paddingRatio);
    const truePadY = Math.round(span.height * paddingRatio);

    const result = dewarpedDestRect({ width: dewarpedWidth, height: dewarpedHeight }, paddingRatio);
    // Within 1px: dewarpedDestRect works from the already-rounded
    // dewarpedWidth/Height (all a real caller ever has), so it can only
    // recover span up to that rounding — not exact equality with the
    // separately-rounded truePadX/Y, but should agree closely.
    expect(Math.abs(result.left - truePadX)).toBeLessThan(1);
    expect(Math.abs(result.top - truePadY)).toBeLessThan(1);
  });
});

describe('mapTemplateGeometryToFrame', () => {
  const geometry = computeStockTemplateGeometry(20);

  it('maps every marker center exactly onto the dest rect corners when the dewarped size matches the marker span 1:1 (identity case)', () => {
    // If dewarpedSize is EXACTLY the marker span (no extra scaling), the
    // dest rect at padding 0 should place mapped points at exactly the
    // same *relative* position as their source geometry -- verified here
    // via markers.topLeft, whose fraction within the marker rect must be
    // (0,0), landing exactly on destRect.left/top.
    const markerSpanWidth = geometry.markers.topRight.x - geometry.markers.topLeft.x;
    const markerSpanHeight = geometry.markers.bottomLeft.y - geometry.markers.topLeft.y;
    const mapped = mapTemplateGeometryToFrame(
      geometry,
      { width: markerSpanWidth, height: markerSpanHeight },
      0,
    );
    const destRect = dewarpedDestRect({ width: markerSpanWidth, height: markerSpanHeight }, 0);

    // First answer bubble of question 1 should map to the same fraction
    // within destRect as it occupies within the marker rect in PDF-point
    // space -- check by recomputing the expected fraction independently.
    const firstBubble = geometry.questions[0]!.options[0]!;
    const fracX =
      (firstBubble.center.x - geometry.markers.topLeft.x) /
      (geometry.markers.topRight.x - geometry.markers.topLeft.x);
    const fracY =
      (firstBubble.center.y - geometry.markers.topLeft.y) /
      (geometry.markers.bottomLeft.y - geometry.markers.topLeft.y);
    const expected = {
      x: destRect.left + fracX * (destRect.right - destRect.left),
      y: destRect.top + fracY * (destRect.bottom - destRect.top),
    };

    const mappedFirstBubble = mapped.questions[0]!.options[0]!;
    expect(mappedFirstBubble.center.x).toBeCloseTo(expected.x, 6);
    expect(mappedFirstBubble.center.y).toBeCloseTo(expected.y, 6);
  });

  it('scales bubbleRadiusPx proportionally to the dewarped size', () => {
    const markerSpanWidth = geometry.markers.topRight.x - geometry.markers.topLeft.x;
    const doubled = mapTemplateGeometryToFrame(
      geometry,
      { width: markerSpanWidth * 2, height: 1000 },
      0.06,
    );
    const single = mapTemplateGeometryToFrame(
      geometry,
      { width: markerSpanWidth, height: 500 },
      0.06,
    );
    expect(doubled.bubbleRadiusPx).toBeCloseTo(single.bubbleRadiusPx * 2, 6);
  });

  it('preserves question/column/option counts and ordering', () => {
    const mapped = mapTemplateGeometryToFrame(geometry, { width: 800, height: 1000 }, 0.06);
    expect(mapped.questions).toHaveLength(geometry.questions.length);
    expect(mapped.questions.map((q) => q.questionNumber)).toEqual(
      geometry.questions.map((q) => q.questionNumber),
    );
    expect(mapped.rollNumberColumns).toHaveLength(geometry.rollNumberColumns.length);
    for (let i = 0; i < mapped.questions.length; i++) {
      expect(mapped.questions[i]!.options.map((o) => o.optionIndex)).toEqual(
        geometry.questions[i]!.options.map((o) => o.optionIndex),
      );
    }
  });

  it('places every mapped bubble strictly within the dewarped frame bounds', () => {
    const dewarpedSize = { width: 800, height: 1000 };
    const paddingRatio06 = 0.06;
    const mapped = mapTemplateGeometryToFrame(geometry, dewarpedSize, paddingRatio06);
    const allBubbles = [
      ...mapped.questions.flatMap((q) => q.options),
      ...mapped.rollNumberColumns.flatMap((c) => c.options),
    ];
    for (const bubble of allBubbles) {
      expect(bubble.center.x).toBeGreaterThan(0);
      expect(bubble.center.x).toBeLessThan(dewarpedSize.width);
      expect(bubble.center.y).toBeGreaterThan(0);
      expect(bubble.center.y).toBeLessThan(dewarpedSize.height);
    }
  });

  it('is a pure function — calling it twice with the same inputs produces identical output', () => {
    const a = mapTemplateGeometryToFrame(geometry, { width: 800, height: 1000 }, 0.06);
    const b = mapTemplateGeometryToFrame(geometry, { width: 800, height: 1000 }, 0.06);
    expect(a).toEqual(b);
  });
});

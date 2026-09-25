import { describe, expect, it } from 'vitest';
import { StabilityGate } from './stability-gate';
import type { CornerDetectionResult, CornerName, DetectedCorner, Point } from './corner-markers';

const BASE_CENTERS: Record<CornerName, Point> = {
  topLeft: { x: 80, y: 80 },
  topRight: { x: 920, y: 80 },
  bottomRight: { x: 920, y: 1220 },
  bottomLeft: { x: 80, y: 1220 },
};

function corner(name: CornerName, center: Point): DetectedCorner {
  const half = 40;
  return {
    name,
    center,
    markerCorners: [
      { x: center.x - half, y: center.y - half },
      { x: center.x + half, y: center.y - half },
      { x: center.x + half, y: center.y + half },
      { x: center.x - half, y: center.y + half },
    ],
  };
}

function complete(offsets: Partial<Record<CornerName, Point>> = {}): CornerDetectionResult {
  const names = Object.keys(BASE_CENTERS) as CornerName[];
  const corners = {} as Record<CornerName, DetectedCorner>;
  for (const name of names) {
    const offset = offsets[name] ?? { x: 0, y: 0 };
    corners[name] = corner(name, {
      x: BASE_CENTERS[name].x + offset.x,
      y: BASE_CENTERS[name].y + offset.y,
    });
  }
  return { complete: true, corners };
}

const INCOMPLETE: CornerDetectionResult = { complete: false, found: {} };

describe('StabilityGate', () => {
  it('reports searching for an incomplete detection', () => {
    const gate = new StabilityGate();
    expect(gate.update(INCOMPLETE, 0)).toEqual({ status: 'searching' });
  });

  it('starts stabilizing at elapsedMs 0 on the first complete frame', () => {
    const gate = new StabilityGate();
    expect(gate.update(complete(), 1000)).toEqual({
      status: 'stabilizing',
      elapsedMs: 0,
      requiredMs: 500,
    });
  });

  it('captures once the corners hold within tolerance for the full window', () => {
    const gate = new StabilityGate();
    gate.update(complete(), 0);
    expect(gate.update(complete(), 200)).toEqual({
      status: 'stabilizing',
      elapsedMs: 200,
      requiredMs: 500,
    });
    expect(gate.update(complete(), 499)).toEqual({
      status: 'stabilizing',
      elapsedMs: 499,
      requiredMs: 500,
    });

    const result = gate.update(complete(), 500);
    expect(result.status).toBe('captured');
    if (result.status === 'captured') {
      expect(result.corners.topLeft.center).toEqual(BASE_CENTERS.topLeft);
    }
  });

  it('tolerates sub-threshold jitter without resetting the timer', () => {
    const gate = new StabilityGate();
    gate.update(complete(), 0);
    // 3px jitter, under the 6px default tolerance.
    gate.update(complete({ topLeft: { x: 3, y: 0 } }), 300);
    const result = gate.update(complete(), 500);
    expect(result.status).toBe('captured');
  });

  it('resets the timer when a corner moves beyond tolerance', () => {
    const gate = new StabilityGate();
    gate.update(complete(), 0);
    gate.update(complete(), 300);
    // 20px jump, well over the 6px default tolerance.
    const reset = gate.update(complete({ topLeft: { x: 20, y: 0 } }), 350);
    expect(reset).toEqual({ status: 'stabilizing', elapsedMs: 0, requiredMs: 500 });
    // Capture is measured from the new reference, not the original start.
    expect(gate.update(complete({ topLeft: { x: 20, y: 0 } }), 849).status).toBe('stabilizing');
    expect(gate.update(complete({ topLeft: { x: 20, y: 0 } }), 850).status).toBe('captured');
  });

  it('never captures while the sheet keeps moving every frame', () => {
    const gate = new StabilityGate();
    let now = 0;
    for (let i = 0; i < 50; i++) {
      now += 50;
      const result = gate.update(complete({ topLeft: { x: i % 2 === 0 ? 15 : -15, y: 0 } }), now);
      expect(result.status).not.toBe('captured');
    }
  });

  it('stays in cooldown after capturing and does not re-capture the same held sheet', () => {
    const gate = new StabilityGate();
    gate.update(complete(), 0);
    const captured = gate.update(complete(), 500);
    expect(captured.status).toBe('captured');

    expect(gate.update(complete(), 600)).toEqual({ status: 'cooldown' });
    expect(gate.update(complete(), 5000)).toEqual({ status: 'cooldown' });
  });

  it('re-arms after the sheet is removed and can capture again', () => {
    const gate = new StabilityGate();
    gate.update(complete(), 0);
    expect(gate.update(complete(), 500).status).toBe('captured');
    expect(gate.update(complete(), 600)).toEqual({ status: 'cooldown' });

    // Sheet removed.
    expect(gate.update(INCOMPLETE, 700)).toEqual({ status: 'searching' });

    // A new sheet held steady captures again.
    gate.update(complete(), 800);
    expect(gate.update(complete(), 1300).status).toBe('captured');
  });
});

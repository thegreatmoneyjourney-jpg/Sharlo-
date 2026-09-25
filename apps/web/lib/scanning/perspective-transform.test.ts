import { describe, expect, it, vi } from 'vitest';
import { computeNormalizedSize, dewarpFrame } from './perspective-transform';
import type { PerspectiveCv } from './perspective-transform';
import type { CornerName, CvMat, DetectedCorner, Point } from './corner-markers';

function corner(name: CornerName, center: Point): DetectedCorner {
  return { name, center, markerCorners: [center, center, center, center] };
}

function corners(
  overrides: Partial<Record<CornerName, Point>> = {},
): Record<CornerName, DetectedCorner> {
  const base: Record<CornerName, Point> = {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 100, y: 0 },
    bottomRight: { x: 100, y: 100 },
    bottomLeft: { x: 0, y: 100 },
  };
  const out = {} as Record<CornerName, DetectedCorner>;
  for (const name of Object.keys(base) as CornerName[]) {
    out[name] = corner(name, overrides[name] ?? base[name]);
  }
  return out;
}

describe('computeNormalizedSize', () => {
  // paddingRatio: 0 isolates the underlying marker-span math from the
  // padding behavior, which gets its own dedicated tests below.
  it('sizes a perfect square from its edge length', () => {
    expect(computeNormalizedSize(corners(), 0)).toEqual({ width: 100, height: 100 });
  });

  it('sizes a rectangle from its distinct width/height', () => {
    const rect = corners({
      topRight: { x: 200, y: 0 },
      bottomRight: { x: 200, y: 100 },
    });
    expect(computeNormalizedSize(rect, 0)).toEqual({ width: 200, height: 100 });
  });

  it('takes the larger of two foreshortened opposite edges, not an average', () => {
    // Top edge shortened to simulate the top of the sheet tilting away
    // from the camera; bottom edge stays full-length. An average would
    // give 80; the closer (larger, less-foreshortened) edge is 100.
    const tilted = corners({
      topLeft: { x: 20, y: 0 },
      topRight: { x: 80, y: 0 },
    });
    expect(computeNormalizedSize(tilted, 0).width).toBe(100);
  });

  it('pads every side by the given ratio, by default', () => {
    // 100x100 span, default ~6% ratio each side -> 100 * 1.12 = 112.
    expect(computeNormalizedSize(corners())).toEqual({ width: 112, height: 112 });
  });

  it('accepts a custom padding ratio', () => {
    expect(computeNormalizedSize(corners(), 0.1)).toEqual({ width: 120, height: 120 });
  });
});

function buildFakeCv() {
  const deletions: string[] = [];
  const calls: Record<string, unknown[][]> = {};
  function record(name: string, args: unknown[]) {
    (calls[name] ??= []).push(args);
  }

  function makeMat(tag: string): CvMat {
    return {
      rows: 4,
      cols: 1,
      delete: vi.fn(() => deletions.push(tag)),
    } as unknown as CvMat;
  }

  const cv = {
    CV_32FC2: 13,
    INTER_LINEAR: 1,
    BORDER_CONSTANT: 0,
    matFromArray: vi.fn((rows: number, cols: number, type: number, data: number[]) => {
      record('matFromArray', [rows, cols, type, data]);
      return makeMat(calls.matFromArray!.length === 1 ? 'src' : 'dst');
    }),
    getPerspectiveTransform: vi.fn((src: CvMat, dst: CvMat) => {
      record('getPerspectiveTransform', [src, dst]);
      return makeMat('transform');
    }),
    warpPerspective: vi.fn((...args: unknown[]) => {
      record('warpPerspective', args);
    }),
    Size: vi.fn(function (this: { width: number; height: number }, width: number, height: number) {
      this.width = width;
      this.height = height;
    }),
    Mat: vi.fn(function (this: CvMat) {
      Object.assign(this, makeMat('output'));
    }),
    getBuildInformation: () => 'fake',
  };

  return { cv: cv as unknown as PerspectiveCv, calls, deletions };
}

const FAKE_FRAME = { rows: 1, cols: 1, delete: vi.fn() } as unknown as CvMat;

describe('dewarpFrame', () => {
  it('builds source points from the corner centers and unpadded (ratio 0) destination points from the computed size, in matching order', () => {
    const { cv, calls } = buildFakeCv();
    // Offset square so src and dst are guaranteed to differ — a coincidentally-
    // symmetric fixture could pass even with src/dst swapped.
    const offsetSquare = corners({
      topLeft: { x: 50, y: 30 },
      topRight: { x: 150, y: 30 },
      bottomRight: { x: 150, y: 130 },
      bottomLeft: { x: 50, y: 130 },
    });

    dewarpFrame(cv, FAKE_FRAME, offsetSquare, 0);

    const [srcCall, dstCall] = calls.matFromArray!;
    expect(srcCall[3]).toEqual([50, 30, 150, 30, 150, 130, 50, 130]); // topLeft, topRight, bottomRight, bottomLeft
    expect(dstCall[3]).toEqual([0, 0, 100, 0, 100, 100, 0, 100]); // (0,0) (w,0) (w,h) (0,h)
  });

  it('insets destination points by the padding ratio, by default, rather than placing corners exactly on the output edges', () => {
    const { cv, calls } = buildFakeCv();

    const result = dewarpFrame(cv, FAKE_FRAME, corners());

    // 100x100 span -> 112x112 output, 6px padding each side.
    expect(result).toMatchObject({ width: 112, height: 112 });
    const [, dstCall] = calls.matFromArray!;
    expect(dstCall[3]).toEqual([6, 6, 106, 6, 106, 106, 6, 106]);
  });

  it('calls warpPerspective with the computed output size and INTER_LINEAR/BORDER_CONSTANT', () => {
    const { cv, calls } = buildFakeCv();

    const result = dewarpFrame(cv, FAKE_FRAME, corners(), 0);

    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
    const [, , , dsize, flags, borderMode] = calls.warpPerspective![0];
    expect(dsize).toEqual({ width: 100, height: 100 });
    expect(flags).toBe(1); // INTER_LINEAR
    expect(borderMode).toBe(0); // BORDER_CONSTANT
  });

  it('deletes the intermediate src/dst/transform Mats but leaves the output for the caller', () => {
    const { cv, deletions } = buildFakeCv();

    const result = dewarpFrame(cv, FAKE_FRAME, corners(), 0);

    expect(deletions.sort()).toEqual(['dst', 'src', 'transform']);
    expect(result.mat.delete).not.toHaveBeenCalled();
  });

  it('still cleans up everything, including the output, if warpPerspective throws', () => {
    const { cv, deletions } = buildFakeCv();
    (cv.warpPerspective as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => dewarpFrame(cv, FAKE_FRAME, corners(), 0)).toThrow('boom');
    expect(deletions.sort()).toEqual(['dst', 'output', 'src', 'transform']);
  });
});

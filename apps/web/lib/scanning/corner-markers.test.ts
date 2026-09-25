import { describe, expect, it, vi } from 'vitest';
import { CornerMarkerDetector } from './corner-markers';
import type { ArucoCv, Point } from './corner-markers';

/**
 * These tests exercise this module's own logic (matching detected IDs to
 * named corners, computing centroids, complete-vs-partial detection,
 * cleanup) — NOT OpenCV's actual marker detection, which can't run in
 * jsdom (WASM execution needs a real browser; verified separately, see
 * docs/reports/SHARLO-M1-003.md's "How this was tested"). The fake `cv`
 * below simulates `detectMarkers` populating `ids`/`corners` exactly as
 * the real ArUco detector does, based on markers this test declares are
 * "present in the frame" — enough to test everything downstream of that
 * boundary.
 */

function fakeSquareCorners(topLeft: Point, size: number): [Point, Point, Point, Point] {
  return [
    topLeft,
    { x: topLeft.x + size, y: topLeft.y },
    { x: topLeft.x + size, y: topLeft.y + size },
    { x: topLeft.x, y: topLeft.y + size },
  ];
}

/**
 * Builds a fake `cv` whose `detectMarkers` reports exactly
 * `presentMarkers`, and tracks every Mat/MatVector-like object it hands
 * out so a test can assert they were all `delete()`d.
 */
function makeFakeCv(presentMarkers: Array<{ id: number; corners: [Point, Point, Point, Point] }>) {
  const deleteSpies: Array<ReturnType<typeof vi.fn>> = [];

  function trackedDeletable<T extends object>(extra: T): T & { delete: ReturnType<typeof vi.fn> } {
    const deleteFn = vi.fn();
    deleteSpies.push(deleteFn);
    return Object.assign(extra, { delete: deleteFn });
  }

  const cv: ArucoCv = {
    getPredefinedDictionary: vi.fn(() => ({})),
    aruco_DetectorParameters: vi.fn(function (this: { cornerRefinementMethod: number }) {
      this.cornerRefinementMethod = 0;
    }) as unknown as ArucoCv['aruco_DetectorParameters'],
    aruco_RefineParameters: vi.fn(function (this: object) {
      // constructor body intentionally empty — this test only needs the
      // instance to exist, not to carry any particular fields
    }) as unknown as ArucoCv['aruco_RefineParameters'],
    aruco_ArucoDetector: vi.fn(function (this: {
      detectMarkers: (
        image: unknown,
        corners: { get: (i: number) => unknown },
        ids: { rows: number; intPtr: (r: number, c: number) => Int32Array },
      ) => void;
    }) {
      this.detectMarkers = (
        _image: unknown,
        corners: { get: (i: number) => unknown },
        ids: { rows: number; intPtr: (r: number, c: number) => Int32Array },
      ) => {
        ids.rows = presentMarkers.length;
        ids.intPtr = (i: number) => new Int32Array([presentMarkers[i].id]);
        corners.get = (i: number) =>
          trackedDeletable({
            data32F: new Float32Array(presentMarkers[i].corners.flatMap((p) => [p.x, p.y])),
          });
      };
    }) as unknown as ArucoCv['aruco_ArucoDetector'],
    CORNER_REFINE_SUBPIX: 1,
    MatVector: vi.fn(function (this: object) {
      Object.assign(this, trackedDeletable({ size: () => 0 }));
    }) as unknown as ArucoCv['MatVector'],
    Mat: vi.fn(function (this: object) {
      Object.assign(this, trackedDeletable({ rows: 0, cols: 0 }));
    }) as unknown as ArucoCv['Mat'],
    matFromImageData: vi.fn() as unknown as ArucoCv['matFromImageData'],
    getBuildInformation: vi.fn(() => 'fake-build-info'),
  };

  return { cv, deleteSpies };
}

const ALL_FOUR = [
  { id: 0, corners: fakeSquareCorners({ x: 10, y: 10 }, 20) }, // topLeft
  { id: 1, corners: fakeSquareCorners({ x: 470, y: 10 }, 20) }, // topRight
  { id: 2, corners: fakeSquareCorners({ x: 470, y: 630 }, 20) }, // bottomRight
  { id: 3, corners: fakeSquareCorners({ x: 10, y: 630 }, 20) }, // bottomLeft
];

describe('CornerMarkerDetector', () => {
  it('reports complete detection with all 4 named corners when all 4 markers are found', () => {
    const { cv } = makeFakeCv(ALL_FOUR);
    const detector = new CornerMarkerDetector(cv);

    const result = detector.detect({} as never);

    expect(result.complete).toBe(true);
    if (!result.complete) throw new Error('unreachable');
    expect(result.corners.topLeft.center).toEqual({ x: 20, y: 20 });
    expect(result.corners.topRight.center).toEqual({ x: 480, y: 20 });
    expect(result.corners.bottomRight.center).toEqual({ x: 480, y: 640 });
    expect(result.corners.bottomLeft.center).toEqual({ x: 20, y: 640 });
  });

  it('reports incomplete detection when fewer than 4 markers are found, never guessing the rest', () => {
    const { cv } = makeFakeCv(ALL_FOUR.slice(0, 3)); // missing bottomLeft
    const detector = new CornerMarkerDetector(cv);

    const result = detector.detect({} as never);

    expect(result.complete).toBe(false);
    if (result.complete) throw new Error('unreachable');
    expect(Object.keys(result.found).sort()).toEqual(['bottomRight', 'topLeft', 'topRight']);
    expect(result.found.bottomLeft).toBeUndefined();
  });

  it('ignores a detected marker whose ID is not one of the 4 expected corners', () => {
    const { cv } = makeFakeCv([
      ...ALL_FOUR,
      { id: 47, corners: fakeSquareCorners({ x: 200, y: 300 }, 20) }, // some other marker in frame
    ]);
    const detector = new CornerMarkerDetector(cv);

    const result = detector.detect({} as never);

    expect(result.complete).toBe(true);
    if (!result.complete) throw new Error('unreachable');
    expect(Object.keys(result.corners).sort()).toEqual([
      'bottomLeft',
      'bottomRight',
      'topLeft',
      'topRight',
    ]);
  });

  it('reports complete: false with nothing found when no markers are present', () => {
    const { cv } = makeFakeCv([]);
    const detector = new CornerMarkerDetector(cv);

    const result = detector.detect({} as never);

    expect(result).toEqual({ complete: false, found: {} });
  });

  it('deletes every Mat/MatVector it allocates per detect() call, including per-marker corner mats', () => {
    const { cv, deleteSpies } = makeFakeCv(ALL_FOUR);
    const detector = new CornerMarkerDetector(cv);

    detector.detect({} as never);

    // ids Mat + corners MatVector + rejected MatVector + 4 per-marker corner Mats = 7
    expect(deleteSpies.length).toBe(7);
    for (const spy of deleteSpies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });
});

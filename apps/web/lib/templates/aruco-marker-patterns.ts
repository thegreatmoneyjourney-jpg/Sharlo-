/**
 * Exact `DICT_4X4_50` bit patterns for the 4 corner marker IDs
 * (`CORNER_MARKER_IDS`, `lib/scanning/corner-markers.ts`), for **drawing**
 * a printable marker — the detection side never needs this, only the
 * template-PDF generator (`scripts/generate-stock-templates.mjs`) does.
 *
 * Not hand-derived: OpenCV's ArUco dictionaries are a fixed internal
 * lookup table with no public formula to compute from an ID, and getting
 * a single cell wrong here would silently produce a printed marker that
 * doesn't match what `cv.aruco_ArucoDetector` (loaded from the exact same
 * `getPredefinedDictionary(0)`) expects — breaking corner detection on
 * every physical copy of a stock template in a way invisible until
 * someone actually prints and scans one. Extracted empirically instead:
 * called `cv.generateImageMarker(getPredefinedDictionary(0), id, ...)` in
 * a real browser, read the resulting image's pixels back out cell-by-cell,
 * and cross-checked by running the *same* generated image back through
 * `cv.aruco_ArucoDetector` and confirming it reports the expected ID —
 * the extraction and OpenCV's own detector agree, for all 4 IDs. See
 * `docs/reports/SHARLO-M2-001.md` for the extraction script and raw
 * output.
 *
 * Each marker is a `MARKER_BORDER_CELLS`-wide solid black border (already
 * confirmed uniformly black in the extraction — the outer ring below is
 * synthesized, not separately stored) around this 4×4 **data** grid.
 * `1` = black (ink), `0` = white (paper), row-major, top-left origin —
 * matches `borderBits: 1` in every `cv.generateImageMarker` call
 * elsewhere in this codebase (`corner-markers.test.ts` fixtures,
 * `tests/detection-harness/fixtures.ts`), so a marker drawn from this
 * data is bit-for-bit the same image `cv.generateImageMarker` itself
 * would produce for that ID.
 */

import type { CornerName } from '../scanning/corner-markers';
import { CORNER_MARKER_IDS } from '../scanning/corner-markers';

export const ARUCO_DATA_GRID_SIZE = 4;
export const MARKER_BORDER_CELLS = 1;
export const ARUCO_TOTAL_GRID_SIZE = ARUCO_DATA_GRID_SIZE + 2 * MARKER_BORDER_CELLS;

/** `[row][col]`, 4×4, row-major from top-left — the marker's data cells only, border not included. */
export type ArucoDataGrid = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
];

const MARKER_DATA_GRID_BY_ID: Record<number, ArucoDataGrid> = {
  0: [
    [0, 1, 0, 0],
    [1, 0, 1, 0],
    [1, 1, 0, 0],
    [1, 1, 0, 1],
  ],
  1: [
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 1, 0, 1],
  ],
  2: [
    [1, 1, 0, 0],
    [1, 1, 0, 0],
    [1, 1, 0, 1],
    [0, 0, 1, 0],
  ],
  3: [
    [0, 1, 1, 0],
    [0, 1, 1, 0],
    [1, 0, 1, 1],
    [1, 0, 0, 1],
  ],
};

/** Data-grid bit pattern for one of the 4 corner markers, by corner name (not raw ID) — mirrors how every other consumer in this codebase (`CORNER_MARKER_IDS`) addresses markers. */
export function arucoDataGridForCorner(corner: CornerName): ArucoDataGrid {
  return MARKER_DATA_GRID_BY_ID[CORNER_MARKER_IDS[corner]];
}

/** The full `ARUCO_TOTAL_GRID_SIZE`×`ARUCO_TOTAL_GRID_SIZE` grid a printed marker actually needs, with its solid black border synthesized around the data grid — 1 = black ink, 0 = white paper, same convention as the data grid. */
export function fullMarkerGrid(dataGrid: ArucoDataGrid): number[][] {
  const grid: number[][] = [];
  for (let row = 0; row < ARUCO_TOTAL_GRID_SIZE; row++) {
    const rowBits: number[] = [];
    for (let col = 0; col < ARUCO_TOTAL_GRID_SIZE; col++) {
      const isBorder =
        row < MARKER_BORDER_CELLS ||
        col < MARKER_BORDER_CELLS ||
        row >= ARUCO_TOTAL_GRID_SIZE - MARKER_BORDER_CELLS ||
        col >= ARUCO_TOTAL_GRID_SIZE - MARKER_BORDER_CELLS;
      rowBits.push(isBorder ? 1 : dataGrid[row - MARKER_BORDER_CELLS][col - MARKER_BORDER_CELLS]);
    }
    grid.push(rowBits);
  }
  return grid;
}

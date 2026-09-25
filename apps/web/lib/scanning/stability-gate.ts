import type { CornerDetectionResult, CornerName, DetectedCorner, Point } from './corner-markers';

/**
 * FR-SCAN-02: once all 4 corners are detected and haven't moved
 * significantly for ~500ms, auto-capture — no manual tap required.
 *
 * Each new complete detection is compared against the position recorded
 * when the *current* stable streak started, not against the immediately
 * preceding frame. Comparing only to the previous frame would let slow,
 * continuous drift sneak through as a series of individually-small
 * "stable" steps even though the sheet moved substantially over the
 * full window — comparing to a fixed reference for the whole window
 * closes that gap.
 *
 * DEFAULT_PIXEL_DELTA_TOLERANCE_PX is calibrated against the ~1920px-wide
 * feed camera.ts (M1-002) requests as its "ideal" resolution. It's a
 * reasonable starting default, not a value tuned against real device/
 * hand-tremor data yet — see docs/reports/SHARLO-M1-004.md.
 */
export const DEFAULT_STABILITY_WINDOW_MS = 500;
export const DEFAULT_PIXEL_DELTA_TOLERANCE_PX = 6;

export interface StabilityGateConfig {
  stabilityWindowMs: number;
  pixelDeltaTolerancePx: number;
}

export type StabilityGateStatus =
  | { status: 'searching' }
  | { status: 'stabilizing'; elapsedMs: number; requiredMs: number }
  | { status: 'captured'; corners: Record<CornerName, DetectedCorner> }
  | { status: 'cooldown' };

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Stateful, framework-agnostic — one instance tracks one "session" of
 * holding a sheet up to the camera. Never invents or interpolates a
 * capture: it only ever fires from a real complete detection that has
 * genuinely held still for the configured window.
 */
export class StabilityGate {
  private readonly config: StabilityGateConfig;
  private referenceCenters: Record<CornerName, Point> | null = null;
  private stableSince: number | null = null;
  // True once a capture has fired for the sheet currently in frame —
  // stays true (status stays 'cooldown') until detection goes incomplete
  // (the sheet is removed/swapped), so the same held-still sheet doesn't
  // re-trigger a capture every frame it continues to sit there.
  private awaitingRemoval = false;

  constructor(config: Partial<StabilityGateConfig> = {}) {
    this.config = {
      stabilityWindowMs: config.stabilityWindowMs ?? DEFAULT_STABILITY_WINDOW_MS,
      pixelDeltaTolerancePx: config.pixelDeltaTolerancePx ?? DEFAULT_PIXEL_DELTA_TOLERANCE_PX,
    };
  }

  update(result: CornerDetectionResult, now: number): StabilityGateStatus {
    if (!result.complete) {
      this.referenceCenters = null;
      this.stableSince = null;
      this.awaitingRemoval = false;
      return { status: 'searching' };
    }

    if (this.awaitingRemoval) {
      return { status: 'cooldown' };
    }

    const centers = this.centersOf(result.corners);

    if (!this.referenceCenters || this.movedBeyondTolerance(centers)) {
      this.referenceCenters = centers;
      this.stableSince = now;
      return { status: 'stabilizing', elapsedMs: 0, requiredMs: this.config.stabilityWindowMs };
    }

    const elapsedMs = now - this.stableSince!;
    if (elapsedMs >= this.config.stabilityWindowMs) {
      this.awaitingRemoval = true;
      return { status: 'captured', corners: result.corners };
    }
    return { status: 'stabilizing', elapsedMs, requiredMs: this.config.stabilityWindowMs };
  }

  private centersOf(corners: Record<CornerName, DetectedCorner>): Record<CornerName, Point> {
    const out = {} as Record<CornerName, Point>;
    for (const name of Object.keys(corners) as CornerName[]) {
      out[name] = corners[name].center;
    }
    return out;
  }

  private movedBeyondTolerance(centers: Record<CornerName, Point>): boolean {
    const reference = this.referenceCenters;
    if (!reference) return true;
    return (Object.keys(centers) as CornerName[]).some(
      (name) => distance(centers[name], reference[name]) > this.config.pixelDeltaTolerancePx,
    );
  }
}

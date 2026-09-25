/**
 * Maps a `TemplateGeometry`'s bubble positions (absolute PDF points) to
 * pixel positions inside a dewarped scan frame
 * (`lib/scanning/perspective-transform.ts`'s `dewarpFrame` output) — the
 * "template geometry reader" both `geometry.ts` and `bubble-fill.ts`
 * explicitly flagged as deferred: "A future template-geometry reader
 * (scan-time: map a detected marker rectangle's corners to real bubble
 * pixel positions in a dewarped frame) uses the exact scale/translate
 * technique already proven in `tests/detection-harness/fixtures.ts`'s
 * `expectedDewarpedPoint`" (`geometry.ts`), and "[this] is a later
 * milestone's job (M2-004/M2-005's scan flow)" (`bubble-fill.ts`,
 * `roll-number.ts`). This is that reader.
 *
 * **Why this is exact, not approximate:** `dewarpFrame` warps whatever 4
 * corners it detects onto a *fixed* destination rectangle (the marker
 * span, padded by `paddingRatio`). `geometry.ts` defines every bubble at
 * a fixed PDF-point position relative to that *same* marker rectangle
 * (`geometry.markers`). So a bubble's position expressed as a *fraction*
 * of the marker rectangle is identical in both spaces — PDF points and
 * dewarped-frame pixels — regardless of the tilt angle or distance the
 * sheet was actually photographed at, since undoing exactly that
 * variation is `dewarpFrame`'s whole job. This is the same scale-only
 * (no perspective/shear) homography reasoning `expectedDewarpedPoint`'s
 * own doc comment already proved and this project's detection harness
 * has exercised since M1-010 — this module promotes that proven
 * technique from a test-only helper into the real reader production
 * code needs.
 */

import type { Point } from '../scanning/corner-markers';
import type { NormalizedSize } from '../scanning/perspective-transform';
import type { TemplateGeometry } from './geometry';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function markerRect(geometry: TemplateGeometry): Rect {
  const { topLeft, topRight, bottomLeft } = geometry.markers;
  return { left: topLeft.x, top: topLeft.y, right: topRight.x, bottom: bottomLeft.y };
}

/**
 * The same destination rectangle `dewarpFrame` itself warps onto —
 * marker span, padded by `paddingRatio` on every side. Must be called
 * with the exact `paddingRatio` the actual `dewarpFrame` call used, or
 * the mapping will be systematically off.
 *
 * **`padX`/`padY` are a fraction of the *unpadded* marker span, not of
 * `dewarpedSize` itself** — `dewarpFrame`'s own formula is
 * `padY = Math.round(span.height * paddingRatio)`, where `span.height`
 * is the marker span *before* padding is added, while
 * `dewarpedSize.height = Math.round(span.height * (1 + 2*paddingRatio))`
 * is the span *after*. This function only receives the already-padded
 * `dewarpedSize` (the caller's actual dewarp output), not the original
 * `span`, so it inverts `dewarpFrame`'s formula:
 * `span.height ≈ dewarpedSize.height / (1 + 2*paddingRatio)`, giving
 * `padY = dewarpedSize.height * paddingRatio / (1 + 2*paddingRatio)`.
 *
 * Found empirically, the hard way: an earlier version used
 * `dewarpedSize.height * paddingRatio` directly (padding as a fraction
 * of the *padded* size) — algebraically `(1 + 2*paddingRatio)` times
 * too large, which at `paddingRatio = 0.06` over-pads by ~12%. That
 * pulls every mapped point *toward the vertical/horizontal center*
 * (a scale-compression error, not a translation), invisible near the
 * center and growing linearly with distance from it — which is exactly
 * why it went undetected on the sparse fixtures `fixtures.ts` already
 * used (few rows, near the frame's own center) but produced up to ~16px
 * of Y-error on a real 20-row stock sheet (`docs/reports/
 * SHARLO-M2-004.md`), enough to read multiple genuinely-empty bubbles
 * as ambiguous. Confirmed via a real detect→warp round trip: a
 * horizontal reference line drawn at a known Y read back within ~0.1px
 * of predicted at the frame's vertical center, growing to ~12px off by
 * row 20 — a linear, sign-symmetric-about-center error, the signature
 * of a scale mismatch, not corner-detection noise (independently ruled
 * out: detected vs. theoretical marker positions agreed to within a
 * uniform ~0.5px, and a straight vertical line warped through the real
 * pipeline stayed perfectly straight).
 */
export function dewarpedDestRect(dewarpedSize: NormalizedSize, paddingRatio: number): Rect {
  const { width, height } = dewarpedSize;
  const padX = (width * paddingRatio) / (1 + 2 * paddingRatio);
  const padY = (height * paddingRatio) / (1 + 2 * paddingRatio);
  return {
    left: padX,
    top: padY,
    right: width - padX,
    bottom: height - padY,
  };
}

/**
 * The sampled radius must be strictly smaller than the *printed* bubble
 * radius (`geometry.bubbleRadiusPt`), or the sample circle's own edge
 * sits on top of the printed ring's ink — every bubble, filled or not,
 * then partly samples the ring stroke itself rather than purely its
 * interior, corrupting the fill ratio. Found empirically, not assumed:
 * an initial version that sampled at the *full* `bubbleRadiusPt` (no
 * shrink) made every single bubble on a real rendered/detected/dewarped
 * test sheet read back as `ambiguous`/`flagged`, regardless of whether
 * it was drawn filled or empty — the M1-010 harness's own `fixtures.ts`
 * already established exactly this principle for its own (differently-
 * shaped) synthetic bubbles (`SAMPLE_RADIUS_PX`'s doc comment: "smaller
 * than the outline so the sampled region never includes the printed
 * ring itself"), which this module failed to reuse the first time
 * around. 0.75 leaves a clear, visible margin inside the printed ring
 * (a real pen/pencil fill rarely touches the ring's own printed edge
 * either) while still sampling a large enough area to be robust to
 * small centering error.
 */
export const SAMPLE_RADIUS_RATIO = 0.75;

function mapPoint(point: Point, srcRect: Rect, destRect: Rect): Point {
  const fracX = (point.x - srcRect.left) / (srcRect.right - srcRect.left);
  const fracY = (point.y - srcRect.top) / (srcRect.bottom - srcRect.top);
  return {
    x: destRect.left + fracX * (destRect.right - destRect.left),
    y: destRect.top + fracY * (destRect.bottom - destRect.top),
  };
}

export interface MappedBubble {
  optionIndex: number;
  center: Point;
}
export interface MappedQuestion {
  questionNumber: number;
  options: MappedBubble[];
}
export interface MappedRollColumn {
  columnIndex: number;
  options: MappedBubble[];
}
export interface MappedTemplateGeometry {
  questions: MappedQuestion[];
  rollNumberColumns: MappedRollColumn[];
  /** Sampling radius in dewarped-frame pixels — `geometry.bubbleRadiusPt` scaled by the same PDF-points→pixels factor the marker rectangle itself was scaled by (horizontal scale alone, a reasonable approximation given bubbles are small relative to any real anisotropy between the detected width/height scale factors), then shrunk by `SAMPLE_RADIUS_RATIO` — see that constant's doc comment for why this must be smaller than the printed bubble radius, not equal to it. */
  bubbleRadiusPx: number;
}

/**
 * `dewarpedSize`/`paddingRatio` must describe the *same* dewarp call
 * whose output frame this mapping's results will be sampled against —
 * see `dewarpedDestRect`.
 */
export function mapTemplateGeometryToFrame(
  geometry: TemplateGeometry,
  dewarpedSize: NormalizedSize,
  paddingRatio: number,
): MappedTemplateGeometry {
  const srcRect = markerRect(geometry);
  const destRect = dewarpedDestRect(dewarpedSize, paddingRatio);
  const scaleX = (destRect.right - destRect.left) / (srcRect.right - srcRect.left);

  return {
    questions: geometry.questions.map((q) => ({
      questionNumber: q.questionNumber,
      options: q.options.map((o) => ({
        optionIndex: o.optionIndex,
        center: mapPoint(o.center, srcRect, destRect),
      })),
    })),
    rollNumberColumns: geometry.rollNumberColumns.map((c) => ({
      columnIndex: c.columnIndex,
      options: c.options.map((o) => ({
        optionIndex: o.optionIndex,
        center: mapPoint(o.center, srcRect, destRect),
      })),
    })),
    bubbleRadiusPx: geometry.bubbleRadiusPt * scaleX * SAMPLE_RADIUS_RATIO,
  };
}

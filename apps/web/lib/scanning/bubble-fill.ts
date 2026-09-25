/**
 * Bubble fill sampling & confidence classification (FR-DETECT-02,
 * FR-DETECT-03, NFR-ACC-02, NFR-ACC-03) — framework-agnostic, per
 * ARCHITECTURE.md §3.
 *
 * Scope boundary: this module samples and classifies *caller-supplied*
 * bubble regions (a center + radius) and question groupings (arrays of
 * fill ratios) — it does not know or invent a whole-sheet bubble-grid
 * layout. No real answer-sheet template exists yet (M2-001/M2-002), and
 * inventing a placeholder grid here (the way M1-003 had to invent a
 * placeholder marker scheme to have *anything* to detect against) isn't
 * actually necessary: `TASKS.md`'s own M1-006 description is "sample
 * *each* bubble region," which presupposes a caller already knows where
 * the bubbles are. That caller is a real template reader, which is a
 * later milestone's job once M2-001 defines actual geometry — building
 * one here would mean either inventing fake geometry that could be
 * mistaken for a real product decision, or wiring the live scan page
 * (scan-client.tsx) to overlay a meaningless placeholder grid on real
 * camera frames. Neither is this task's job. See
 * docs/reports/SHARLO-M1-006.md.
 *
 * `sampleBubbleFillRatio` operates directly on `ImageData` — deliberately
 * *not* OpenCV: computing mean darkness inside a circular region is plain
 * pixel-region statistics, not real computer vision, and keeping it
 * OpenCV-free means the single most safety-critical piece of
 * logic in this codebase (the "never guess an ambiguous mark" enforcement
 * in `classifyQuestion` below) is *directly unit-testable in CI*, not
 * dependent on real-browser WASM execution the way M1-003 through M1-005
 * all were.
 */

export interface Point {
  x: number;
  y: number;
}

export interface BubbleRegion {
  /** Pixel coordinates in the image being sampled (e.g., the M1-005 dewarped output). */
  center: Point;
  radius: number;
}

/**
 * 0 (fully white/blank) to 1 (fully black/filled) — one minus the mean
 * normalized luminance of every pixel inside the bubble's circular
 * region.
 *
 * Deliberately a continuous mean, not a fraction of pixels crossing a
 * fixed per-pixel darkness cutoff: an earlier binary-threshold version
 * was verified in a real browser against actually-rendered pixels
 * (canvas anti-aliasing, real alpha blending), not just hand-constructed
 * arrays — and it failed on a real, important case. A per-pixel
 * threshold makes a *uniformly* faint mark (light pencil pressure,
 * evenly covering the whole bubble) an all-or-nothing call: every pixel
 * lands on the same side of the cutoff, so the "fraction dark" is always
 * close to 0 or close to 1, never intermediate — collapsing exactly the
 * "how filled is this" question this function exists to answer down to
 * a second, hidden binary decision. The mean-luminance approach doesn't
 * have this blind spot: a uniformly medium-gray bubble produces a
 * genuinely intermediate ratio, landing in classifyBubbleFill's
 * ambiguous zone as it should. It still handles the other case (a
 * small, fully-dark scribble covering part of an otherwise-white
 * bubble) correctly too, since partial coverage by fully-dark pixels
 * proportionally lowers the mean. See docs/reports/SHARLO-M1-006.md.
 */
export function sampleBubbleFillRatio(imageData: ImageData, region: BubbleRegion): number {
  const { data, width, height } = imageData;
  const { center, radius } = region;

  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(width - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(height - 1, Math.ceil(center.y + radius));
  const radiusSq = radius * radius;

  let luminanceSum = 0;
  let totalCount = 0;

  for (let y = minY; y <= maxY; y++) {
    const dy = y - center.y;
    for (let x = minX; x <= maxX; x++) {
      const dx = x - center.x;
      if (dx * dx + dy * dy > radiusSq) continue; // outside the circle

      const i = (y * width + x) * 4;
      luminanceSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      totalCount++;
    }
  }

  const meanLuminance = totalCount === 0 ? 255 : luminanceSum / totalCount;
  return 1 - meanLuminance / 255;
}

export type BubbleClassification = 'confident-filled' | 'confident-empty' | 'ambiguous';

export interface FillConfidenceThresholds {
  /** Fill ratio at or below this is confidently empty. */
  emptyAtOrBelow: number;
  /** Fill ratio at or above this is confidently filled. */
  filledAtOrAbove: number;
}

/**
 * Placeholder defaults pending real-world tuning — ARCHITECTURE.md §4
 * step 5 calls these out by name as "the single biggest lever on the
 * NFR-ACC-03 vs. NFR-ACC-04 tradeoff... tunable constants, not
 * hardcoded magic numbers, adjusted after M1 real-world testing," and
 * SRS §6.2 flags NFR-ACC-02/03's numeric targets themselves as
 * "engineering starting targets... needing empirical validation against
 * real printed/scanned sample sheets," not yet validated. See
 * docs/reports/SHARLO-M1-006.md.
 */
export const DEFAULT_FILL_THRESHOLDS: FillConfidenceThresholds = {
  emptyAtOrBelow: 0.15,
  filledAtOrAbove: 0.45,
};

/** Closed/closed boundaries with an open ambiguous interior — every real fillRatio value maps to exactly one classification, no gaps or overlaps. */
export function classifyBubbleFill(
  fillRatio: number,
  thresholds: FillConfidenceThresholds = DEFAULT_FILL_THRESHOLDS,
): BubbleClassification {
  if (fillRatio <= thresholds.emptyAtOrBelow) return 'confident-empty';
  if (fillRatio >= thresholds.filledAtOrAbove) return 'confident-filled';
  return 'ambiguous';
}

export type QuestionResult =
  { outcome: 'answered'; optionIndex: number } | { outcome: 'blank' } | { outcome: 'flagged' };

/**
 * THE core trust-guarantee enforcement point (FR-DETECT-03, NFR-ACC-03).
 * `outcome: 'answered'` is reachable from exactly one condition: every
 * option classifies as confident-empty except exactly one, which
 * classifies as confident-filled. Every other combination — any single
 * option merely 'ambiguous' (partial fill, erasure smudge — there's no
 * separate smudge detector; the conservative threshold gap here is what
 * catches it), multiple confidently-filled options (multiple marks), or
 * all confidently empty (left blank, a distinct and *not* flagged
 * outcome from genuine ambiguity) — never produces a guessed answer.
 * `bubble-fill.test.ts`'s "never guesses" suite is this guarantee's
 * actual enforcement mechanism, not just this comment — treat any
 * change here that suite doesn't cover as a gap in that suite, not a
 * safe change.
 */
export function classifyQuestion(
  fillRatios: number[],
  thresholds: FillConfidenceThresholds = DEFAULT_FILL_THRESHOLDS,
): QuestionResult {
  const classifications = fillRatios.map((ratio) => classifyBubbleFill(ratio, thresholds));

  if (classifications.some((c) => c === 'ambiguous')) {
    return { outcome: 'flagged' };
  }

  const filledIndices = classifications
    .map((c, index) => (c === 'confident-filled' ? index : -1))
    .filter((index) => index !== -1);

  if (filledIndices.length === 0) return { outcome: 'blank' };
  if (filledIndices.length === 1) return { outcome: 'answered', optionIndex: filledIndices[0] };
  return { outcome: 'flagged' }; // multiple confidently-filled options — multiple marks
}

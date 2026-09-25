import { describe, expect, it } from 'vitest';
import {
  classifyBubbleFill,
  classifyQuestion,
  DEFAULT_FILL_THRESHOLDS,
  sampleBubbleFillRatio,
} from './bubble-fill';
import type { BubbleRegion } from './bubble-fill';

function makeImageData(
  width: number,
  height: number,
  fill: (x: number, y: number) => number,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const luminance = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = luminance;
      data[i + 1] = luminance;
      data[i + 2] = luminance;
      data[i + 3] = 255;
    }
  }
  return { width, height, data } as unknown as ImageData;
}

describe('sampleBubbleFillRatio', () => {
  const region: BubbleRegion = { center: { x: 10, y: 10 }, radius: 8 };

  it('returns ~1 for a fully dark region', () => {
    const image = makeImageData(20, 20, () => 0);
    expect(sampleBubbleFillRatio(image, region)).toBe(1);
  });

  it('returns 0 for a fully white region', () => {
    const image = makeImageData(20, 20, () => 255);
    expect(sampleBubbleFillRatio(image, region)).toBe(0);
  });

  it('returns roughly half for a region split evenly between dark and light', () => {
    const image = makeImageData(20, 20, (x) => (x < 10 ? 0 : 255));
    const ratio = sampleBubbleFillRatio(image, region);
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.7);
  });

  it('only samples in-bounds pixels for a region that extends past the image edge, without throwing', () => {
    const image = makeImageData(20, 20, () => 0);
    const edgeRegion: BubbleRegion = { center: { x: 0, y: 0 }, radius: 8 };
    expect(() => sampleBubbleFillRatio(image, edgeRegion)).not.toThrow();
    expect(sampleBubbleFillRatio(image, edgeRegion)).toBe(1); // still fully dark, just a smaller sampled area
  });

  it('returns an intermediate ratio for a uniformly faint (medium-gray) region, not 0 or 1', () => {
    // Regression test for a real bug an earlier binary-threshold version
    // had: a uniformly gray region (a light, evenly-pressed pencil mark,
    // not a partial-coverage scribble) must land in the ambiguous zone,
    // not read as flatly empty or flatly filled. See
    // docs/reports/SHARLO-M1-006.md.
    const image = makeImageData(20, 20, () => 178); // matches the real rgba(0,0,0,0.3)-on-white luminance from the browser verification
    const ratio = sampleBubbleFillRatio(image, region);
    expect(ratio).toBeGreaterThan(DEFAULT_FILL_THRESHOLDS.emptyAtOrBelow);
    expect(ratio).toBeLessThan(DEFAULT_FILL_THRESHOLDS.filledAtOrAbove);
  });
});

describe('classifyBubbleFill', () => {
  it('classifies at or below the empty threshold as confident-empty', () => {
    expect(classifyBubbleFill(0)).toBe('confident-empty');
    expect(classifyBubbleFill(DEFAULT_FILL_THRESHOLDS.emptyAtOrBelow)).toBe('confident-empty');
  });

  it('classifies at or above the filled threshold as confident-filled', () => {
    expect(classifyBubbleFill(1)).toBe('confident-filled');
    expect(classifyBubbleFill(DEFAULT_FILL_THRESHOLDS.filledAtOrAbove)).toBe('confident-filled');
  });

  it('classifies strictly between the thresholds as ambiguous', () => {
    const mid =
      (DEFAULT_FILL_THRESHOLDS.emptyAtOrBelow + DEFAULT_FILL_THRESHOLDS.filledAtOrAbove) / 2;
    expect(classifyBubbleFill(mid)).toBe('ambiguous');
  });

  it('respects custom thresholds', () => {
    expect(classifyBubbleFill(0.5, { emptyAtOrBelow: 0.6, filledAtOrAbove: 0.9 })).toBe(
      'confident-empty',
    );
  });
});

const { emptyAtOrBelow: EMPTY, filledAtOrAbove: FILLED } = DEFAULT_FILL_THRESHOLDS;
const AMBIGUOUS_MID = (EMPTY + FILLED) / 2;

describe('classifyQuestion', () => {
  it('answers when exactly one option is confidently filled and the rest are confidently empty', () => {
    expect(classifyQuestion([EMPTY, FILLED, EMPTY, EMPTY])).toEqual({
      outcome: 'answered',
      optionIndex: 1,
    });
  });

  it('reports blank when every option is confidently empty — distinct from a flagged/ambiguous outcome', () => {
    expect(classifyQuestion([EMPTY, EMPTY, EMPTY, EMPTY])).toEqual({ outcome: 'blank' });
  });

  it('handles a single-option question correctly for all three states', () => {
    expect(classifyQuestion([FILLED])).toEqual({ outcome: 'answered', optionIndex: 0 });
    expect(classifyQuestion([EMPTY])).toEqual({ outcome: 'blank' });
    expect(classifyQuestion([AMBIGUOUS_MID])).toEqual({ outcome: 'flagged' });
  });

  // The done-when criterion for this task, verbatim from TASKS.md: "Test
  // suite of deliberately ambiguous sample sheets always routes to
  // 'flagged,' never a guessed answer." This describe block IS that
  // enforcement mechanism, not documentation of it — every case here
  // must produce 'flagged', never 'answered'.
  describe('never guesses — deliberately ambiguous inputs always flag', () => {
    const cases: Array<[string, number[]]> = [
      ['two options confidently filled (multiple marks)', [FILLED, FILLED, EMPTY, EMPTY]],
      ['every option confidently filled', [FILLED, FILLED, FILLED, FILLED]],
      [
        'one option merely ambiguous, the rest empty (partial fill / smudge, no clear pick)',
        [AMBIGUOUS_MID, EMPTY, EMPTY, EMPTY],
      ],
      [
        'one option confidently filled but another is merely ambiguous — the clear pick does not override the smudge',
        [FILLED, AMBIGUOUS_MID, EMPTY, EMPTY],
      ],
      ['one filled, one ambiguous, one empty', [FILLED, AMBIGUOUS_MID, EMPTY]],
      ['every option ambiguous', [AMBIGUOUS_MID, AMBIGUOUS_MID, AMBIGUOUS_MID, AMBIGUOUS_MID]],
      [
        'a fill ratio one step inside the ambiguous zone, just past the empty boundary',
        [EMPTY + 0.001, EMPTY, EMPTY, EMPTY],
      ],
      [
        'a fill ratio one step inside the ambiguous zone, just short of the filled boundary',
        [FILLED - 0.001, EMPTY, EMPTY, EMPTY],
      ],
      ['three confidently filled among five options', [FILLED, FILLED, FILLED, EMPTY, EMPTY]],
    ];

    it.each(cases)('%s', (_description, fillRatios) => {
      expect(classifyQuestion(fillRatios)).toEqual({ outcome: 'flagged' });
    });
  });
});

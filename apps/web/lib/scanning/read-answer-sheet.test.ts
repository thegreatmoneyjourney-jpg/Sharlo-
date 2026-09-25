import { describe, expect, it } from 'vitest';
import { readAnswerSheet } from './read-answer-sheet';
import type { MappedTemplateGeometry } from '../templates/map-geometry-to-frame';

const WIDTH = 100;
const HEIGHT = 100;
const RADIUS = 8;

function whiteImage(): ImageData {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
  return { data, width: WIDTH, height: HEIGHT, colorSpace: 'srgb' } as ImageData;
}

function fillCircle(imageData: ImageData, cx: number, cy: number, radius: number): void {
  const { data, width, height } = imageData;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
        const i = (y * width + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
    }
  }
}

function buildGeometry(
  questionOptionCenters: { x: number; y: number }[][],
): MappedTemplateGeometry {
  return {
    questions: questionOptionCenters.map((options, qi) => ({
      questionNumber: qi + 1,
      options: options.map((center, oi) => ({ optionIndex: oi, center })),
    })),
    rollNumberColumns: [],
    bubbleRadiusPx: RADIUS,
  };
}

describe('readAnswerSheet', () => {
  it('reads a single confidently-filled option as answered', () => {
    const image = whiteImage();
    fillCircle(image, 20, 20, RADIUS);
    const geometry = buildGeometry([
      [
        { x: 20, y: 20 },
        { x: 50, y: 20 },
        { x: 80, y: 20 },
      ],
    ]);

    const result = readAnswerSheet(image, geometry);
    expect(result.questions).toEqual([{ outcome: 'answered', optionIndex: 0 }]);
  });

  it('reads an all-empty question as blank', () => {
    const image = whiteImage();
    const geometry = buildGeometry([
      [
        { x: 20, y: 20 },
        { x: 50, y: 20 },
      ],
    ]);

    const result = readAnswerSheet(image, geometry);
    expect(result.questions).toEqual([{ outcome: 'blank' }]);
  });

  it('flags multiple filled options in one question rather than guessing', () => {
    const image = whiteImage();
    fillCircle(image, 20, 20, RADIUS);
    fillCircle(image, 50, 20, RADIUS);
    const geometry = buildGeometry([
      [
        { x: 20, y: 20 },
        { x: 50, y: 20 },
      ],
    ]);

    const result = readAnswerSheet(image, geometry);
    expect(result.questions).toEqual([{ outcome: 'flagged' }]);
  });

  it('reads roll-number columns independently of questions', () => {
    const image = whiteImage();
    fillCircle(image, 10, 80, RADIUS);
    const geometry: MappedTemplateGeometry = {
      questions: [],
      rollNumberColumns: [
        {
          columnIndex: 0,
          options: [
            { optionIndex: 0, center: { x: 10, y: 80 } },
            { optionIndex: 1, center: { x: 40, y: 80 } },
          ],
        },
      ],
      bubbleRadiusPx: RADIUS,
    };

    const result = readAnswerSheet(image, geometry);
    expect(result.rollNumberColumns).toEqual([{ outcome: 'answered', optionIndex: 0 }]);
  });

  it('reads multiple independent questions correctly in one call', () => {
    const image = whiteImage();
    fillCircle(image, 20, 20, RADIUS); // Q1 option 0
    fillCircle(image, 50, 50, RADIUS); // Q2 option 1
    const geometry = buildGeometry([
      [
        { x: 20, y: 20 },
        { x: 20, y: 50 },
      ],
      [
        { x: 50, y: 20 },
        { x: 50, y: 50 },
      ],
    ]);

    const result = readAnswerSheet(image, geometry);
    expect(result.questions).toEqual([
      { outcome: 'answered', optionIndex: 0 },
      { outcome: 'answered', optionIndex: 1 },
    ]);
  });
});

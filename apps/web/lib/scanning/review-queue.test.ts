import { describe, expect, it } from 'vitest';
import { boundingCropRect, buildReviewItemSpecs } from './review-queue';
import { computeStockTemplateGeometry } from '../templates/geometry';
import { mapTemplateGeometryToFrame } from '../templates/map-geometry-to-frame';
import type { ReadAnswerSheetResult } from './read-answer-sheet';
import type { QuestionResult } from './bubble-fill';

const FRAME_SIZE = { width: 800, height: 1000 };
const GEOMETRY = computeStockTemplateGeometry(20);
const MAPPED = mapTemplateGeometryToFrame(GEOMETRY, FRAME_SIZE, 0.06);

function allAnswered(count: number): QuestionResult[] {
  return Array.from({ length: count }, () => ({ outcome: 'answered' as const, optionIndex: 0 }));
}

describe('boundingCropRect', () => {
  it('produces a padded box that contains every bubble center', () => {
    const bubbles = MAPPED.questions[0]!.options;
    const rect = boundingCropRect(bubbles, MAPPED.bubbleRadiusPx, FRAME_SIZE);
    for (const bubble of bubbles) {
      expect(bubble.center.x).toBeGreaterThanOrEqual(rect.left);
      expect(bubble.center.x).toBeLessThanOrEqual(rect.left + rect.width);
      expect(bubble.center.y).toBeGreaterThanOrEqual(rect.top);
      expect(bubble.center.y).toBeLessThanOrEqual(rect.top + rect.height);
    }
  });

  it('clamps to the frame bounds rather than producing a negative or oversized rect', () => {
    const rect = boundingCropRect(MAPPED.questions[0]!.options, MAPPED.bubbleRadiusPx, FRAME_SIZE);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.left + rect.width).toBeLessThanOrEqual(FRAME_SIZE.width);
    expect(rect.top + rect.height).toBeLessThanOrEqual(FRAME_SIZE.height);
  });
});

describe('buildReviewItemSpecs', () => {
  it('returns no items when every question is answered and the roll number reads cleanly', () => {
    const readResult: ReadAnswerSheetResult = {
      questions: allAnswered(20),
      rollNumberColumns: [{ outcome: 'answered', optionIndex: 4 }],
    };
    const items = buildReviewItemSpecs(
      readResult,
      MAPPED,
      { status: 'read', value: '4' },
      FRAME_SIZE,
    );
    expect(items).toEqual([]);
  });

  it('adds one question item per flagged question, with the correct question number', () => {
    const questions = allAnswered(20);
    questions[4] = { outcome: 'flagged' }; // question 5
    questions[9] = { outcome: 'flagged' }; // question 10
    const readResult: ReadAnswerSheetResult = {
      questions,
      rollNumberColumns: [{ outcome: 'answered', optionIndex: 4 }],
    };

    const items = buildReviewItemSpecs(
      readResult,
      MAPPED,
      { status: 'read', value: '4' },
      FRAME_SIZE,
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'question', questionNumber: 5 });
    expect(items[1]).toMatchObject({ kind: 'question', questionNumber: 10 });
  });

  it('adds a roll-number item when the roll number is unreadable', () => {
    const readResult: ReadAnswerSheetResult = {
      questions: allAnswered(20),
      rollNumberColumns: [{ outcome: 'blank' }],
    };
    const items = buildReviewItemSpecs(readResult, MAPPED, { status: 'unreadable' }, FRAME_SIZE);
    expect(items).toEqual([{ kind: 'roll-number', cropRect: expect.any(Object) }]);
  });

  it('a flagged question and an unreadable roll number on the same sheet both appear', () => {
    const questions = allAnswered(20);
    questions[0] = { outcome: 'flagged' };
    const readResult: ReadAnswerSheetResult = {
      questions,
      rollNumberColumns: [{ outcome: 'flagged' }],
    };
    const items = buildReviewItemSpecs(readResult, MAPPED, { status: 'unreadable' }, FRAME_SIZE);
    expect(items.map((i) => i.kind)).toEqual(['question', 'roll-number']);
  });
});

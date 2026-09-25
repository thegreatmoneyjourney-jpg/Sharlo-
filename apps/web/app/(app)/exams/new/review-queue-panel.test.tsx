import { describe, expect, it } from 'vitest';
import { purgeExpiredCrops } from './review-queue-panel';
import type { ReviewQueueItem } from './review-queue-panel';

const RETENTION_MS = 15 * 60 * 1000;
const NOW = 1_000_000_000; // an arbitrary fixed epoch ms, unrelated to real time

function questionItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: 'q1',
    studentId: 1,
    addedAt: NOW,
    cropDataUrl: 'data:image/png;base64,FAKE',
    kind: 'question',
    questionNumber: 1,
    optionCount: 4,
    ...overrides,
  } as ReviewQueueItem;
}

describe('purgeExpiredCrops', () => {
  it('leaves an item untouched when it was added well within the retention window', () => {
    const items = [questionItem({ addedAt: NOW })];
    const result = purgeExpiredCrops(items, NOW + RETENTION_MS - 1, RETENTION_MS);
    expect(result[0]!.cropDataUrl).toBe('data:image/png;base64,FAKE');
  });

  it('purges (sets cropDataUrl to null) an item exactly at the retention cutoff', () => {
    const items = [questionItem({ addedAt: NOW })];
    const result = purgeExpiredCrops(items, NOW + RETENTION_MS, RETENTION_MS);
    expect(result[0]!.cropDataUrl).toBeNull();
  });

  it('purges an item well past the retention window', () => {
    const items = [questionItem({ addedAt: NOW })];
    const result = purgeExpiredCrops(items, NOW + RETENTION_MS + 60_000, RETENTION_MS);
    expect(result[0]!.cropDataUrl).toBeNull();
  });

  it('never removes the item itself — only the image — and every other field is preserved', () => {
    const items = [questionItem({ addedAt: NOW, id: 'q7', questionNumber: 7, optionCount: 5 })];
    const result = purgeExpiredCrops(items, NOW + RETENTION_MS + 1, RETENTION_MS);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'q7',
      questionNumber: 7,
      optionCount: 5,
      cropDataUrl: null,
    });
  });

  it('is idempotent — purging an already-purged item leaves it null, not an error', () => {
    const items = [questionItem({ addedAt: NOW, cropDataUrl: null })];
    const result = purgeExpiredCrops(items, NOW + RETENTION_MS + 1, RETENTION_MS);
    expect(result[0]!.cropDataUrl).toBeNull();
  });

  it('only purges the expired items in a mixed queue, leaving fresh ones alone', () => {
    const stale = questionItem({ id: 'stale', addedAt: NOW });
    const fresh = questionItem({ id: 'fresh', addedAt: NOW + RETENTION_MS });
    const result = purgeExpiredCrops([stale, fresh], NOW + RETENTION_MS + 1, RETENTION_MS);
    const byId = Object.fromEntries(result.map((item) => [item.id, item]));
    expect(byId.stale!.cropDataUrl).toBeNull();
    expect(byId.fresh!.cropDataUrl).toBe('data:image/png;base64,FAKE');
  });

  it('purges a roll-number item the same way as a question item', () => {
    const items: ReviewQueueItem[] = [
      {
        id: 'roll',
        studentId: 1,
        addedAt: NOW,
        cropDataUrl: 'data:image/png;base64,FAKE',
        kind: 'roll-number',
      },
    ];
    const result = purgeExpiredCrops(items, NOW + RETENTION_MS + 1, RETENTION_MS);
    expect(result[0]!.cropDataUrl).toBeNull();
  });

  it('returns the exact same array reference when nothing changed, so callers can skip a state update', () => {
    const items = [questionItem({ addedAt: NOW })];
    const result = purgeExpiredCrops(items, NOW + 1000, RETENTION_MS);
    expect(result).toBe(items);
  });

  it('handles an empty queue', () => {
    expect(purgeExpiredCrops([], NOW, RETENTION_MS)).toEqual([]);
  });
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewQueuePanel, purgeExpiredCrops } from './review-queue-panel';
import type { ReviewQueueItem } from './review-queue-panel';

const RETENTION_MS = 15 * 60 * 1000;
const NOW = 1_000_000_000; // an arbitrary fixed epoch ms, unrelated to real time

afterEach(cleanup);

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
        reason: 'unread',
        readValue: null,
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

describe('ReviewQueuePanel roll-number items (M3-007)', () => {
  function rollNumberItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
    return {
      id: 'roll',
      studentId: 1,
      addedAt: NOW,
      cropDataUrl: null,
      kind: 'roll-number',
      reason: 'unread',
      readValue: null,
      ...overrides,
    } as ReviewQueueItem;
  }

  it('shows an "unread" message with no pre-filled value', () => {
    render(
      <ReviewQueuePanel
        items={[rollNumberItem({ reason: 'unread', readValue: null })]}
        onResolveQuestion={vi.fn()}
        onResolveRollNumber={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/couldn't be read/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Roll number')).toHaveValue('');
  });

  it('shows an "unmatched" message and pre-fills the read value', () => {
    render(
      <ReviewQueuePanel
        items={[rollNumberItem({ reason: 'unmatched', readValue: '013' })]}
        onResolveQuestion={vi.fn()}
        onResolveRollNumber={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/013.*no matching student/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Roll number')).toHaveValue('013');
  });

  it('resolves with the (possibly-edited) pre-filled value', () => {
    const onResolveRollNumber = vi.fn();
    const item = rollNumberItem({ reason: 'unmatched', readValue: '013' });
    render(
      <ReviewQueuePanel
        items={[item]}
        onResolveQuestion={vi.fn()}
        onResolveRollNumber={onResolveRollNumber}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Roll number'), { target: { value: '13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onResolveRollNumber).toHaveBeenCalledWith(item, '13');
  });
});

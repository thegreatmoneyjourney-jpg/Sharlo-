import { describe, expect, it } from 'vitest';
import { advanceBatch, classifyFile, keyAttemptRejection, startBatch } from './batch-import';
import type { BatchQueueItem } from './batch-import';
import type { Mode } from './exam-scan-mode';

function imageItem(label: string): BatchQueueItem {
  return { kind: 'image', label, file: new File([], label, { type: 'image/jpeg' }) };
}

describe('classifyFile', () => {
  it('classifies image MIME types', () => {
    expect(classifyFile(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe('image');
    expect(classifyFile(new File([], 'a.png', { type: 'image/png' }))).toBe('image');
  });

  it('classifies application/pdf', () => {
    expect(classifyFile(new File([], 'a.pdf', { type: 'application/pdf' }))).toBe('pdf');
  });

  it('rejects anything else, regardless of file extension', () => {
    expect(classifyFile(new File([], 'a.pdf', { type: 'text/plain' }))).toBe('unsupported');
    expect(classifyFile(new File([], 'a.exe', { type: 'application/octet-stream' }))).toBe(
      'unsupported',
    );
  });
});

describe('startBatch', () => {
  it('starts in the processing phase at index 0 when there are items', () => {
    const items = [imageItem('a.jpg'), imageItem('b.jpg')];
    expect(startBatch(items)).toEqual({
      phase: 'processing',
      items,
      index: 0,
      succeeded: 0,
      failures: [],
    });
  });

  it('carries over failures collected while building the queue', () => {
    const items = [imageItem('a.jpg')];
    const initialFailures = [{ label: 'bad.txt', reason: 'Not a supported image or PDF file.' }];
    expect(startBatch(items, initialFailures)).toEqual({
      phase: 'processing',
      items,
      index: 0,
      succeeded: 0,
      failures: initialFailures,
    });
  });

  it('goes straight to done when there are no items to process', () => {
    const initialFailures = [{ label: 'bad.txt', reason: 'Not a supported image or PDF file.' }];
    expect(startBatch([], initialFailures)).toEqual({
      phase: 'done',
      items: [],
      succeeded: 0,
      failures: initialFailures,
    });
  });
});

describe('advanceBatch', () => {
  it('moves to the next index and counts a success when no failure is passed', () => {
    const items = [imageItem('a.jpg'), imageItem('b.jpg'), imageItem('c.jpg')];
    const batch = startBatch(items);
    expect(advanceBatch(batch)).toEqual({
      phase: 'processing',
      items,
      index: 1,
      succeeded: 1,
      failures: [],
    });
  });

  it('appends a failure without counting it as a success or dropping the item from the count', () => {
    const items = [imageItem('a.jpg'), imageItem('b.jpg')];
    const batch = startBatch(items);
    const failure = { label: 'a.jpg', reason: "Couldn't find the sheet's corner markers." };
    expect(advanceBatch(batch, failure)).toEqual({
      phase: 'processing',
      items,
      index: 1,
      succeeded: 0,
      failures: [failure],
    });
  });

  it('transitions to done after the last item, preserving accumulated success/failure counts', () => {
    const items = [imageItem('a.jpg')];
    const batch = startBatch(items);
    const failure = { label: 'a.jpg', reason: 'boom' };
    expect(advanceBatch(batch, failure)).toEqual({
      phase: 'done',
      items,
      succeeded: 0,
      failures: [failure],
    });
  });

  it("doesn't let a pre-expansion rejection (never an item) count against the success total", () => {
    // Regression case: a file rejected before it ever became an item (see
    // `buildBatchQueue`'s unsupported-file branch) must not make a fully
    // successful batch look like it had failures — `succeeded` is tracked
    // directly rather than derived from `items.length - failures.length`,
    // which would double-count this kind of failure (see the type's own
    // doc comment).
    const items = [imageItem('good.jpg')];
    const initialFailures = [{ label: 'bad.txt', reason: 'Not a supported image or PDF file.' }];
    const batch = startBatch(items, initialFailures);
    expect(advanceBatch(batch)).toEqual({
      phase: 'done',
      items,
      succeeded: 1,
      failures: initialFailures,
    });
  });

  it('is a no-op once already done', () => {
    const done = startBatch([]);
    expect(advanceBatch(done, { label: 'x', reason: 'y' })).toBe(done);
  });
});

describe('keyAttemptRejection', () => {
  it('returns null when the key was accepted (phase advanced)', () => {
    const prev: Mode = { phase: 'capture-key' };
    const next: Mode = {
      phase: 'scan-students',
      key: [],
      students: [],
      reviewQueue: [],
      showReviewQueue: false,
      pendingDuplicate: null,
    };
    expect(keyAttemptRejection(prev, next)).toBeNull();
  });

  it('returns the error when a key attempt was rejected', () => {
    const prev: Mode = { phase: 'capture-key' };
    const next: Mode = { phase: 'capture-key', error: "Question 2 wasn't clearly marked." };
    expect(keyAttemptRejection(prev, next)).toBe("Question 2 wasn't clearly marked.");
  });

  it('returns null once already in scan-students phase (not a key attempt at all)', () => {
    const prev: Mode = {
      phase: 'scan-students',
      key: [],
      students: [],
      reviewQueue: [],
      showReviewQueue: false,
      pendingDuplicate: null,
    };
    expect(keyAttemptRejection(prev, prev)).toBeNull();
  });
});

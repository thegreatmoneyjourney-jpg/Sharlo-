import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {
  deleteEnvelope,
  getEnvelope,
  listAllEnvelopes,
  listEnvelopesByType,
  putEnvelope,
  type StoredEnvelope,
} from './local-envelope-store';

function makeEnvelope(overrides: Partial<StoredEnvelope> = {}): StoredEnvelope {
  return {
    schemaVersion: 1,
    type: 'examResults',
    recordId: 'record-1',
    ciphertext: 'opaque-ciphertext-blob',
    ...overrides,
  };
}

// A fresh in-memory IndexedDB per test — fake-indexeddb persists across
// tests in the same module otherwise, which would let one test's data
// leak into the next and mask a real missing-cleanup bug.
beforeEach(() => {
  indexedDB.deleteDatabase('sharlo-local');
});

afterEach(() => {
  indexedDB.deleteDatabase('sharlo-local');
});

describe('local-envelope-store', () => {
  it('returns undefined for a recordId that was never stored', async () => {
    expect(await getEnvelope('does-not-exist')).toBeUndefined();
  });

  it('round-trips an envelope by its recordId', async () => {
    const envelope = makeEnvelope();
    await putEnvelope(envelope);
    expect(await getEnvelope(envelope.recordId)).toEqual(envelope);
  });

  it('overwrites an existing envelope that shares the same recordId', async () => {
    await putEnvelope(makeEnvelope({ ciphertext: 'first-version' }));
    await putEnvelope(makeEnvelope({ ciphertext: 'second-version' }));

    const stored = await getEnvelope('record-1');
    expect(stored?.ciphertext).toBe('second-version');
    expect(await listAllEnvelopes()).toHaveLength(1);
  });

  it('deletes an envelope, after which it can no longer be found', async () => {
    await putEnvelope(makeEnvelope());
    await deleteEnvelope('record-1');
    expect(await getEnvelope('record-1')).toBeUndefined();
  });

  it('deleting a recordId that does not exist is a no-op, not an error', async () => {
    await expect(deleteEnvelope('never-existed')).resolves.toBeUndefined();
  });

  it('listAllEnvelopes returns every stored envelope regardless of type', async () => {
    await putEnvelope(makeEnvelope({ recordId: 'a', type: 'examResults' }));
    await putEnvelope(makeEnvelope({ recordId: 'b', type: 'roster' }));

    const all = await listAllEnvelopes();
    expect(all.map((e) => e.recordId).sort()).toEqual(['a', 'b']);
  });

  it('listEnvelopesByType returns only envelopes matching that type', async () => {
    await putEnvelope(makeEnvelope({ recordId: 'a', type: 'examResults' }));
    await putEnvelope(makeEnvelope({ recordId: 'b', type: 'roster' }));
    await putEnvelope(makeEnvelope({ recordId: 'c', type: 'examResults' }));

    const examResults = await listEnvelopesByType('examResults');
    expect(examResults.map((e) => e.recordId).sort()).toEqual(['a', 'c']);
  });

  it('listEnvelopesByType returns an empty array for a type with no stored envelopes', async () => {
    expect(await listEnvelopesByType('attendance')).toEqual([]);
  });
});

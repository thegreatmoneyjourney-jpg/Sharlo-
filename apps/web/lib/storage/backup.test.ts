import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { getEnvelope, putEnvelope, type StoredEnvelope } from './local-envelope-store';
import { createBackupBlob, restoreBackupFromFile } from './backup';

function makeEnvelope(overrides: Partial<StoredEnvelope> = {}): StoredEnvelope {
  return {
    schemaVersion: 1,
    type: 'examResults',
    recordId: 'record-1',
    ciphertext: 'opaque-ciphertext-blob',
    ...overrides,
  };
}

function backupFile(json: unknown): File {
  return new File([JSON.stringify(json)], 'sharlo-backup.json', { type: 'application/json' });
}

beforeEach(() => {
  indexedDB.deleteDatabase('sharlo-local');
});

afterEach(() => {
  indexedDB.deleteDatabase('sharlo-local');
});

describe('createBackupBlob', () => {
  it('produces an empty envelopes array when nothing is stored', async () => {
    const blob = await createBackupBlob();
    const parsed = JSON.parse(await blob.text());
    expect(parsed.envelopes).toEqual([]);
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe('string');
  });

  it('includes every stored envelope exactly', async () => {
    const a = makeEnvelope({ recordId: 'a' });
    const b = makeEnvelope({ recordId: 'b', type: 'roster' });
    await putEnvelope(a);
    await putEnvelope(b);

    const blob = await createBackupBlob();
    const parsed = JSON.parse(await blob.text());
    expect(parsed.envelopes).toHaveLength(2);
    expect(parsed.envelopes.map((e: StoredEnvelope) => e.recordId).sort()).toEqual(['a', 'b']);
  });
});

describe('restoreBackupFromFile', () => {
  it('restores every valid envelope from a backup file into local storage', async () => {
    const file = backupFile({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      envelopes: [makeEnvelope({ recordId: 'a' }), makeEnvelope({ recordId: 'b' })],
    });

    const result = await restoreBackupFromFile(file);

    expect(result).toEqual({ restored: 2, skipped: 0 });
    expect(await getEnvelope('a')).toBeDefined();
    expect(await getEnvelope('b')).toBeDefined();
  });

  it('skips malformed entries individually rather than aborting the whole restore', async () => {
    const file = backupFile({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      envelopes: [
        makeEnvelope({ recordId: 'good' }),
        { not: 'a valid envelope' },
        null,
        makeEnvelope({ recordId: 'also-good' }),
      ],
    });

    const result = await restoreBackupFromFile(file);

    expect(result).toEqual({ restored: 2, skipped: 2 });
    expect(await getEnvelope('good')).toBeDefined();
    expect(await getEnvelope('also-good')).toBeDefined();
  });

  it('upserts by recordId — importing the same backup twice is safe, not a duplicate', async () => {
    const file = backupFile({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      envelopes: [makeEnvelope({ recordId: 'a', ciphertext: 'version-1' })],
    });

    await restoreBackupFromFile(file);
    await restoreBackupFromFile(file);

    expect((await getEnvelope('a'))?.ciphertext).toBe('version-1');
  });

  it('rejects a file that is not valid JSON', async () => {
    const file = new File(['not json at all {{{'], 'garbage.json', { type: 'application/json' });
    await expect(restoreBackupFromFile(file)).rejects.toThrow(/not valid JSON/);
  });

  it('rejects valid JSON that is not shaped like a Sharlo backup file', async () => {
    const file = backupFile({ hello: 'world' });
    await expect(restoreBackupFromFile(file)).rejects.toThrow(/does not look like a Sharlo backup/);
  });
});

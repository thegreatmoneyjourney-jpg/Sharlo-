import { describe, expect, it } from 'vitest';
import { loadRoster, listRosters, saveRoster } from './roster-store';
import type { EnvelopeStore } from '../storage/envelope-store';
import type { StoredEnvelope } from '../storage/local-envelope-store';
import type { Roster } from './roster';

function createFakeStore(): EnvelopeStore {
  const envelopes = new Map<string, StoredEnvelope>();
  return {
    async putEnvelope(envelope) {
      envelopes.set(envelope.recordId, envelope);
    },
    async getEnvelope(recordId) {
      return envelopes.get(recordId);
    },
    async deleteEnvelope(recordId) {
      envelopes.delete(recordId);
    },
    async listEnvelopesByType(type) {
      return [...envelopes.values()].filter((e) => e.type === type);
    },
    async listAllEnvelopes() {
      return [...envelopes.values()];
    },
  };
}

function generateTestMasterKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

describe('roster-store', () => {
  it('round-trips a saved roster through loadRoster', async () => {
    const store = createFakeStore();
    const masterKey = generateTestMasterKey();
    const roster: Roster = {
      recordId: 'class-1',
      className: 'Grade 8A',
      entries: [{ rollNumber: '1', studentName: 'Alice' }],
    };

    await saveRoster(store, masterKey, roster);
    const loaded = await loadRoster(store, masterKey, 'class-1');

    expect(loaded).toEqual(roster);
  });

  it('returns undefined for a recordId with no saved roster', async () => {
    const store = createFakeStore();
    const masterKey = generateTestMasterKey();
    expect(await loadRoster(store, masterKey, 'does-not-exist')).toBeUndefined();
  });

  it('overwrites an existing class roster in place on re-save (same recordId)', async () => {
    const store = createFakeStore();
    const masterKey = generateTestMasterKey();
    const original: Roster = {
      recordId: 'class-1',
      className: 'Grade 8A',
      entries: [{ rollNumber: '1', studentName: 'Alice' }],
    };
    const updated: Roster = { ...original, entries: [{ rollNumber: '1', studentName: 'Alicia' }] };

    await saveRoster(store, masterKey, original);
    await saveRoster(store, masterKey, updated);
    const rosters = await listRosters(store, masterKey);

    expect(rosters).toEqual([updated]);
  });

  it('lists every saved roster, decrypted', async () => {
    const store = createFakeStore();
    const masterKey = generateTestMasterKey();
    const rosterA: Roster = { recordId: 'a', className: 'Grade 8A', entries: [] };
    const rosterB: Roster = { recordId: 'b', className: 'Grade 9B', entries: [] };

    await saveRoster(store, masterKey, rosterA);
    await saveRoster(store, masterKey, rosterB);
    const rosters = await listRosters(store, masterKey);

    expect(rosters.sort((x, y) => x.recordId.localeCompare(y.recordId))).toEqual([
      rosterA,
      rosterB,
    ]);
  });

  it('fails to decrypt with the wrong master key', async () => {
    const store = createFakeStore();
    const roster: Roster = { recordId: 'class-1', className: 'Grade 8A', entries: [] };
    await saveRoster(store, generateTestMasterKey(), roster);

    await expect(loadRoster(store, generateTestMasterKey(), 'class-1')).rejects.toThrow();
  });
});

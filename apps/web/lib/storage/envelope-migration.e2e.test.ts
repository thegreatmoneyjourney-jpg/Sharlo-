import { describe, expect, it } from 'vitest';
import { decryptEnvelope, encryptEnvelope } from './envelope-crypto';
import { migrateEnvelopeContent, type MigrationFn } from './envelope-migration';
import type { Bytes } from '../crypto/encoding';
import type { EnvelopeStore } from './envelope-store';
import type { StoredEnvelope } from './local-envelope-store';

/**
 * `M3-013`'s own "done when" criterion: a v1-shaped record migrates to a
 * deliberately-introduced v2 shape, through the *real* pipeline (encrypt,
 * store, decrypt, migrate) — not `envelope-migration.test.ts`'s
 * pure-function unit tests in isolation, and not against any real
 * production envelope type (none has needed a v2 yet). `migrationFixture`
 * is a synthetic type that exists only in this file.
 */

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

function randomMasterKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

const FIXTURE_TYPE = 'migrationFixture';
const FIXTURE_TARGET_VERSION = 2;

interface FixtureV1Content {
  name: string;
}

interface FixtureV2Content {
  name: string;
  active: boolean;
}

const FIXTURE_MIGRATIONS: Record<number, MigrationFn> = {
  1: (content) => ({ ...(content as FixtureV1Content), active: true }),
};

async function loadAndMigrateFixture(
  store: EnvelopeStore,
  masterKey: Bytes,
  recordId: string,
): Promise<FixtureV2Content> {
  const stored = await store.getEnvelope(recordId);
  if (!stored) throw new Error(`expected a stored fixture envelope for ${recordId}`);

  const rawContent = await decryptEnvelope<unknown>(masterKey, stored);
  return migrateEnvelopeContent<FixtureV2Content>(
    stored.schemaVersion,
    FIXTURE_TARGET_VERSION,
    rawContent,
    FIXTURE_MIGRATIONS,
  );
}

describe('envelope migration, end-to-end', () => {
  it('migrates a v1-shaped record to a deliberately-introduced v2 shape through the real encrypt/store/decrypt/migrate pipeline', async () => {
    const store = createFakeStore();
    const masterKey = randomMasterKey();

    const v1Content: FixtureV1Content = { name: 'Aisha' };
    const envelope = await encryptEnvelope(masterKey, FIXTURE_TYPE, 'fixture-1', v1Content, 1);
    await store.putEnvelope(envelope);

    const migrated = await loadAndMigrateFixture(store, masterKey, 'fixture-1');

    expect(migrated).toEqual({ name: 'Aisha', active: true });
  });

  it('round-trips a record already written at the target version with no migration applied', async () => {
    const store = createFakeStore();
    const masterKey = randomMasterKey();

    const v2Content: FixtureV2Content = { name: 'Zainab', active: false };
    const envelope = await encryptEnvelope(
      masterKey,
      FIXTURE_TYPE,
      'fixture-2',
      v2Content,
      FIXTURE_TARGET_VERSION,
    );
    await store.putEnvelope(envelope);

    const migrated = await loadAndMigrateFixture(store, masterKey, 'fixture-2');

    expect(migrated).toEqual(v2Content);
  });
});

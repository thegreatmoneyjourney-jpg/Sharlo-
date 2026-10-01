import { encryptEnvelope, decryptEnvelope } from '../storage/envelope-crypto';
import { migrateEnvelopeContent } from '../storage/envelope-migration';
import type { Bytes } from '../crypto/encoding';
import type { EnvelopeStore } from '../storage/envelope-store';
import type { StoredEnvelope } from '../storage/local-envelope-store';
import type { Roster, RosterEntry } from './roster';

/**
 * `M3-007` (`FR-ROSTER-01`'s "stored encrypted") — a thin wrapper over
 * the `M3-006` envelope primitives, not a new storage backend: a roster
 * is just another encrypted envelope (`type: 'roster'`, already
 * anticipated by `ARCHITECTURE.md` §7's own illustration), upserted by
 * `recordId` exactly like every other envelope type.
 *
 * `store: EnvelopeStore` is an explicit parameter rather than this module
 * calling `getEnvelopeStore()` itself — the caller (the roster-picker UI)
 * resolves the store once and passes it in, matching this codebase's
 * existing dependency-injection test seams (`drive-envelope-store.ts`'s
 * injectable `fetchImpl`/`getAccessToken`) rather than needing to mock a
 * whole module just to unit-test this one.
 */

const ROSTER_ENVELOPE_TYPE = 'roster';

/** `M3-013`: this type's own content-shape version — bump this and add a `ROSTER_MIGRATIONS[N]` entry when `RosterContent`'s shape ever changes; never touch `envelope-crypto.ts`'s generic encryption to do it. */
const CURRENT_ROSTER_SCHEMA_VERSION = 1;

/** No migrations registered yet — nothing has ever needed one. Kept here, not inlined at the call site, so the next real migration's `[N]: fn` entry is the only addition a future change needs to make. */
const ROSTER_MIGRATIONS: Record<number, (content: unknown) => unknown> = {};

interface RosterContent {
  className: string;
  entries: RosterEntry[];
}

function toRoster(recordId: string, content: RosterContent): Roster {
  return { recordId, className: content.className, entries: content.entries };
}

/** Creates a brand-new class's roster, or overwrites an existing class's roster in place (re-uploading a corrected/updated CSV for the same class reuses that class's `recordId`) — the same upsert-by-`recordId` semantic every other envelope type already has. */
export async function saveRoster(
  store: EnvelopeStore,
  masterKey: Bytes,
  roster: Roster,
): Promise<void> {
  const envelope = await encryptEnvelope(
    masterKey,
    ROSTER_ENVELOPE_TYPE,
    roster.recordId,
    { className: roster.className, entries: roster.entries } satisfies RosterContent,
    CURRENT_ROSTER_SCHEMA_VERSION,
  );
  await store.putEnvelope(envelope);
}

async function decryptAndMigrateRoster(
  masterKey: Bytes,
  envelope: StoredEnvelope,
): Promise<Roster> {
  const raw = await decryptEnvelope<unknown>(masterKey, envelope);
  const content = migrateEnvelopeContent<RosterContent>(
    envelope.schemaVersion,
    CURRENT_ROSTER_SCHEMA_VERSION,
    raw,
    ROSTER_MIGRATIONS,
  );
  return toRoster(envelope.recordId, content);
}

/** Every class's roster this account has saved — for the "pick an existing class" step of exam setup. */
export async function listRosters(store: EnvelopeStore, masterKey: Bytes): Promise<Roster[]> {
  const envelopes = await store.listEnvelopesByType(ROSTER_ENVELOPE_TYPE);
  return Promise.all(envelopes.map((envelope) => decryptAndMigrateRoster(masterKey, envelope)));
}

export async function loadRoster(
  store: EnvelopeStore,
  masterKey: Bytes,
  recordId: string,
): Promise<Roster | undefined> {
  const envelope = await store.getEnvelope(recordId);
  if (!envelope) return undefined;
  return decryptAndMigrateRoster(masterKey, envelope);
}

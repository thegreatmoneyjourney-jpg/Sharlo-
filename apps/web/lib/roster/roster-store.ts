import { encryptEnvelope, decryptEnvelope } from '../storage/envelope-crypto';
import type { Bytes } from '../crypto/encoding';
import type { EnvelopeStore } from '../storage/envelope-store';
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
  const envelope = await encryptEnvelope(masterKey, ROSTER_ENVELOPE_TYPE, roster.recordId, {
    className: roster.className,
    entries: roster.entries,
  } satisfies RosterContent);
  await store.putEnvelope(envelope);
}

/** Every class's roster this account has saved — for the "pick an existing class" step of exam setup. */
export async function listRosters(store: EnvelopeStore, masterKey: Bytes): Promise<Roster[]> {
  const envelopes = await store.listEnvelopesByType(ROSTER_ENVELOPE_TYPE);
  return Promise.all(
    envelopes.map(async (envelope) => {
      const content = await decryptEnvelope<RosterContent>(masterKey, envelope);
      return toRoster(envelope.recordId, content);
    }),
  );
}

export async function loadRoster(
  store: EnvelopeStore,
  masterKey: Bytes,
  recordId: string,
): Promise<Roster | undefined> {
  const envelope = await store.getEnvelope(recordId);
  if (!envelope) return undefined;
  const content = await decryptEnvelope<RosterContent>(masterKey, envelope);
  return toRoster(recordId, content);
}

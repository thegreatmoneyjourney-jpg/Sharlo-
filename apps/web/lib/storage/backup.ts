import { listAllEnvelopes, putEnvelope, type StoredEnvelope } from './local-envelope-store';

/**
 * `M3-005`/`FR-AUTH-06` — "Export backup file" / "Import backup file,"
 * the local-only account's only way to move data across devices or
 * recover from a cleared browser, since there's no Drive to fall back
 * to (`ARCHITECTURE.md` §7: "this also doubles as the cross-device
 * migration path for local-only users"). Deliberately dumb, matching
 * `local-envelope-store.ts`'s own scope: this never decrypts an
 * envelope's payload, only moves the same opaque JSON objects in and out
 * of IndexedDB as a single file.
 */
export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupFile {
  schemaVersion: number;
  exportedAt: string;
  envelopes: StoredEnvelope[];
}

/** Pure/framework-agnostic on purpose — the actual download trigger (`URL.createObjectURL` + `<a download>`) is the UI's job, same split `recovery-key-reveal-card.tsx` already established. */
export async function createBackupBlob(): Promise<Blob> {
  const backup: BackupFile = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    envelopes: await listAllEnvelopes(),
  };
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
}

function isStoredEnvelope(value: unknown): value is StoredEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.schemaVersion === 'number' &&
    typeof candidate.type === 'string' &&
    candidate.type.length > 0 &&
    typeof candidate.recordId === 'string' &&
    candidate.recordId.length > 0
  );
}

export interface RestoreBackupResult {
  restored: number;
  skipped: number;
}

/**
 * Restores every envelope from a previously-exported backup file into
 * IndexedDB, upserting by `recordId` (same overwrite semantics as
 * `putEnvelope` itself — importing the same backup twice is safe, not a
 * duplicate-accumulation bug). A malformed individual entry is skipped
 * and counted, not a reason to abort the whole restore — the same
 * per-item-failure judgment `M2-009`'s batch import already established,
 * so one corrupted record in an otherwise-good backup doesn't cost the
 * teacher everything else in it. A file that isn't even shaped like a
 * Sharlo backup at all (bad JSON, or valid JSON missing the `envelopes`
 * array) throws instead — there's nothing partial to salvage from that.
 */
export async function restoreBackupFromFile(file: File): Promise<RestoreBackupResult> {
  const text = await file.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON — it does not look like a Sharlo backup file.');
  }

  const envelopes =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { envelopes?: unknown }).envelopes
      : undefined;
  if (!Array.isArray(envelopes)) {
    throw new Error('That file does not look like a Sharlo backup file.');
  }

  let restored = 0;
  let skipped = 0;
  for (const candidate of envelopes) {
    if (isStoredEnvelope(candidate)) {
      await putEnvelope(candidate);
      restored += 1;
    } else {
      skipped += 1;
    }
  }
  return { restored, skipped };
}

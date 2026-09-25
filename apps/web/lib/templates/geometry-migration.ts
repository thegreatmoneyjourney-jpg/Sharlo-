/**
 * Upgrades a stored `templates.geometry` JSONB blob (whatever shape it
 * was saved under) to the current `TemplateGeometry` shape (M2-002,
 * `ARCHITECTURE.md` §14's "every encrypted/stored envelope carries
 * `schemaVersion` so a future app version can detect and migrate older
 * records" requirement, applied here to this table's `geometry` column).
 *
 * There is no real historical "version 0" data — `geometry.ts`'s shape
 * (M2-001) is schema_version 1 from day one. This module exists to prove
 * the *mechanism* works before it's ever actually needed, the same way a
 * migration test is written and run long before the migration it
 * exercises corresponds to real production data. The one handled prior
 * shape (`0`) is a plausible, deliberately-chosen "what came before"
 * baseline: every bubble at a hardcoded, non-configurable radius,
 * matching the exact value `BUBBLE_RADIUS_PT` already uses today —
 * `bubbleRadiusPt` becoming an explicit, storable field (allowing a
 * future per-template radius override) is a realistic first real
 * version bump, not an arbitrary placeholder.
 */

import type { TemplateGeometry } from './geometry';
import { BUBBLE_RADIUS_PT } from './geometry';

/** What every template's bubble radius implicitly was before `bubbleRadiusPt` existed as a stored field. */
const LEGACY_V0_BUBBLE_RADIUS_PT = BUBBLE_RADIUS_PT;

type TemplateGeometryV0 = Omit<TemplateGeometry, 'schemaVersion' | 'bubbleRadiusPt'> & {
  schemaVersion: 0;
};

export class UnsupportedTemplateGeometryVersionError extends Error {
  constructor(schemaVersion: unknown) {
    super(`Unsupported template geometry schemaVersion: ${JSON.stringify(schemaVersion)}`);
    this.name = 'UnsupportedTemplateGeometryVersionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads whatever was actually stored in a `templates.geometry` column
 * (untyped JSONB — Postgres/Drizzle hand it back as `unknown`) and
 * returns a current-shape `TemplateGeometry`, upgrading an older
 * recognized version on the way. Throws on a `schemaVersion` this
 * codebase doesn't know how to upgrade, rather than guessing at a
 * shape — the same "flag, don't guess" principle this whole project
 * applies everywhere else, here applied to reading our own stored data.
 */
export function migrateTemplateGeometry(raw: unknown): TemplateGeometry {
  if (!isRecord(raw)) {
    throw new UnsupportedTemplateGeometryVersionError(raw);
  }

  if (raw.schemaVersion === 1) {
    return raw as unknown as TemplateGeometry;
  }

  if (raw.schemaVersion === 0) {
    const v0 = raw as unknown as TemplateGeometryV0;
    const migrated: TemplateGeometry = {
      ...v0,
      schemaVersion: 1,
      bubbleRadiusPt: LEGACY_V0_BUBBLE_RADIUS_PT,
    };
    return migrated;
  }

  throw new UnsupportedTemplateGeometryVersionError(raw.schemaVersion);
}

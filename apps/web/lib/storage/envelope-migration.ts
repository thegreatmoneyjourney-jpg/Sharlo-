/**
 * `M3-013` (`ARCHITECTURE.md` §14): the generic migration-application
 * step every envelope `type`'s own load function calls, so a future
 * content-shape change is a two-step addition (bump that type's own
 * `CURRENT_..._SCHEMA_VERSION` constant, register one migration
 * function) rather than three — the third step, wiring the call into
 * the load function for the first time, is the one TypeScript can't
 * catch if forgotten (a load function that just returns old-shaped
 * content cast to the new type compiles fine and fails silently), so
 * it's done once, now, while nothing yet needs it for real.
 *
 * Deliberately knows nothing about any specific envelope `type`'s
 * content shape — same "generic, content-agnostic" layering
 * `envelope-crypto.ts` already established; each type's own module
 * owns its version constant and its migration functions, passing both
 * in here rather than this module importing anything type-specific.
 */
export type MigrationFn = (content: unknown) => unknown;

/**
 * Applies `migrations[storedVersion]`, then `migrations[storedVersion + 1]`,
 * and so on, until reaching `targetVersion`. A no-op when `storedVersion`
 * already equals `targetVersion` — the overwhelmingly common case today,
 * since nothing has ever needed a second version yet.
 *
 * Throws, never silently returns partially-migrated or stale-shaped
 * data, in either failure case:
 * - `storedVersion > targetVersion` — the record was written by a
 *   newer app version than the one reading it (a real, reachable case
 *   across multiple devices, not a hypothetical).
 * - A step in the chain has no registered migration — a real gap in
 *   the migrations map, not something to guess through.
 */
export function migrateEnvelopeContent<T>(
  storedVersion: number,
  targetVersion: number,
  content: unknown,
  migrations: Record<number, MigrationFn>,
): T {
  if (storedVersion > targetVersion) {
    throw new Error(
      `Record is schemaVersion ${storedVersion}, newer than this app version supports (${targetVersion}). ` +
        'Update the app before opening it.',
    );
  }

  let migrated = content;
  for (let version = storedVersion; version < targetVersion; version++) {
    const migrate = migrations[version];
    if (!migrate) {
      throw new Error(
        `No migration registered to take a schemaVersion ${version} record to ${version + 1}.`,
      );
    }
    migrated = migrate(migrated);
  }
  return migrated as T;
}

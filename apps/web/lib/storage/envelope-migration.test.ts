import { describe, expect, it } from 'vitest';
import { migrateEnvelopeContent } from './envelope-migration';

describe('migrateEnvelopeContent', () => {
  it('returns the content unchanged when storedVersion already equals targetVersion', () => {
    const content = { foo: 'bar' };
    expect(migrateEnvelopeContent(1, 1, content, {})).toBe(content);
  });

  it('applies a single migration to go from v1 to v2', () => {
    const v1 = { name: 'Alice' };
    const migrations = { 1: (c: unknown) => ({ ...(c as { name: string }), active: true }) };
    expect(migrateEnvelopeContent(1, 2, v1, migrations)).toEqual({ name: 'Alice', active: true });
  });

  it('chains multiple migrations in order to reach a version more than one hop away', () => {
    const v1 = { count: 1 };
    const migrations = {
      1: (c: unknown) => ({ count: (c as { count: number }).count + 10 }), // v1 -> v2
      2: (c: unknown) => ({ count: (c as { count: number }).count * 2 }), // v2 -> v3
    };
    // (1 + 10) * 2 = 22 -- fails if steps run out of order or are skipped.
    expect(migrateEnvelopeContent(1, 3, v1, migrations)).toEqual({ count: 22 });
  });

  it('throws when a required migration step is missing from the chain', () => {
    expect(() => migrateEnvelopeContent(1, 2, {}, {})).toThrow(/no migration registered/i);
  });

  it('throws when storedVersion is newer than targetVersion, never silently using it as-is', () => {
    expect(() => migrateEnvelopeContent(5, 2, {}, {})).toThrow(
      /newer than this app version supports/i,
    );
  });
});

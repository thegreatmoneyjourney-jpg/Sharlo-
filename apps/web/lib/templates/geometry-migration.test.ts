import { describe, expect, it } from 'vitest';
import { computeStockTemplateGeometry } from './geometry';
import {
  UnsupportedTemplateGeometryVersionError,
  migrateTemplateGeometry,
} from './geometry-migration';

/**
 * This is the M2-002 "done when" proof: a deliberately old-shaped
 * template record migrates cleanly. See geometry-migration.ts's own doc
 * comment for why the "v0" fixture below is a deliberately-constructed,
 * plausible prior shape rather than real historical production data —
 * no real v0 data exists, since geometry.ts has been schemaVersion 1
 * since M2-001.
 */
describe('migrateTemplateGeometry', () => {
  it('passes a current-shape (schemaVersion 1) record through unchanged', () => {
    const current = computeStockTemplateGeometry(20);
    expect(migrateTemplateGeometry(current)).toEqual(current);
  });

  it('migrates a deliberately old-shaped (schemaVersion 0) record cleanly to the current shape', () => {
    const current = computeStockTemplateGeometry(20);
    // Explicit field-by-field, not a `{...current}` spread with the new
    // field deleted afterward: v0's fixture shape should stay exactly
    // what v0 was, not silently pick up whatever fields a future v2
    // might add to TemplateGeometry.
    const v0Record = {
      schemaVersion: 0 as const,
      questionCount: current.questionCount,
      pageWidthPt: current.pageWidthPt,
      pageHeightPt: current.pageHeightPt,
      markerSizePt: current.markerSizePt,
      markers: current.markers,
      questions: current.questions,
      rollNumberColumns: current.rollNumberColumns,
    };

    const migrated = migrateTemplateGeometry(v0Record);

    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.bubbleRadiusPt).toBe(current.bubbleRadiusPt);
    // Everything else survives the migration untouched.
    expect(migrated.questions).toEqual(current.questions);
    expect(migrated.rollNumberColumns).toEqual(current.rollNumberColumns);
    expect(migrated.markers).toEqual(current.markers);
    expect(migrated.pageWidthPt).toBe(current.pageWidthPt);
    expect(migrated.pageHeightPt).toBe(current.pageHeightPt);
  });

  it('never silently guesses at an unrecognized schemaVersion — throws instead', () => {
    expect(() => migrateTemplateGeometry({ schemaVersion: 99 })).toThrow(
      UnsupportedTemplateGeometryVersionError,
    );
  });

  it('throws on malformed (non-object) input rather than guessing', () => {
    expect(() => migrateTemplateGeometry(null)).toThrow(UnsupportedTemplateGeometryVersionError);
    expect(() => migrateTemplateGeometry('not a geometry')).toThrow(
      UnsupportedTemplateGeometryVersionError,
    );
  });
});

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { seedStockTemplates } from '../src/db/seed-stock-templates.js';
import { templates } from '../src/db/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * Proves `seedStockTemplates` (M2-002) actually loads M2-001's real
 * `stock-templates-seed.json` — not a fixture standing in for it — and
 * that rerunning it is a genuine no-op on row identity (same ids, no
 * duplicates), which is the property the whole point of the
 * `templates_stock_name_unique` partial index + `ON CONFLICT` exists for.
 *
 * Filters every assertion query to exactly the names in that seed file,
 * never a blanket `is_stock = true` — this suite's own `beforeAll` runs
 * concurrently with `templates-rls.test.ts`'s against the same real
 * Postgres (both are real vitest files, real parallel processes, one
 * shared database — confirmed by actually running them together, not
 * assumed), and that file inserts its own `is_stock: true` fixture row.
 * A broad predicate would pick that row up too and miscount — caught
 * empirically, and the fix (name-scoped queries) is also just a more
 * robust test regardless of what else concurrently exists in the table.
 */
describe.skipIf(!DATABASE_URL)('seedStockTemplates', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const db = drizzle(ownerClient, { schema: { templates } });
  let seedNames: string[] = [];

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
    const seedPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../web/lib/templates/stock-templates-seed.json',
    );
    const seedRecords = JSON.parse(await readFile(seedPath, 'utf8')) as Array<{ name: string }>;
    seedNames = seedRecords.map((r) => r.name);
  });

  afterAll(async () => {
    await ownerClient`DELETE FROM templates WHERE name = ANY(${seedNames})`;
    await ownerClient.end();
  });

  it('inserts exactly the 3 stock templates from the checked-in seed JSON', async () => {
    const count = await seedStockTemplates(DATABASE_URL!);
    expect(count).toBe(3);

    const rows = await db.select().from(templates).where(inArray(templates.name, seedNames));
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.questionCount).sort((a, b) => a - b)).toEqual([20, 50, 100]);
    for (const row of rows) {
      expect(row.isStock).toBe(true);
      expect(row.ownerId).toBeNull();
      expect(row.geometry).toHaveProperty('markers');
      expect(row.geometry).toHaveProperty('questions');
    }
  });

  it('is idempotent — rerunning it updates the same 3 rows in place, never duplicates them', async () => {
    const before = await db.select().from(templates).where(inArray(templates.name, seedNames));
    const idsBefore = before.map((r) => r.id).sort();

    await seedStockTemplates(DATABASE_URL!);
    await seedStockTemplates(DATABASE_URL!);

    const after = await db.select().from(templates).where(inArray(templates.name, seedNames));
    expect(after).toHaveLength(3);
    expect(after.map((r) => r.id).sort()).toEqual(idsBefore);
  });
});

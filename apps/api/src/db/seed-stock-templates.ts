import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { templates } from './schema.js';

/**
 * Loads the 3 stock templates M2-001 generated (`apps/web/lib/templates/
 * stock-templates-seed.json` — geometry + PDFs live in `apps/web`, since
 * that's where `TemplateGeometry`'s shape and the pdf-lib generation
 * code are; this file is the one place that crosses the `apps/web`↔
 * `apps/api` package boundary, via a plain relative filesystem read of
 * checked-in JSON, not a code import — there's no runtime dependency
 * between the two deployable packages, only a shared data file) into the
 * `templates` table.
 *
 * Uses the privileged/owner connection deliberately, same as
 * `runMigrations` — RLS's `templates_insert_own_only` policy means the
 * restricted `app_user` role can never insert an `owner_id IS NULL`
 * (stock) row, by design (see schema.ts's doc comment on that table).
 * Stock templates only exist because *this* script, running with an
 * owner-role connection that bypasses RLS entirely, put them there.
 *
 * Idempotent via `ON CONFLICT` on `templates_stock_name_unique` (schema.ts) —
 * safe to rerun (e.g. after `M2-001` regenerates the seed JSON for a new
 * template `schema_version`) without duplicating rows or rotating their ids.
 */
export async function seedStockTemplates(databaseUrl: string): Promise<number> {
  const seedPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../web/lib/templates/stock-templates-seed.json',
  );
  const seedRecords = JSON.parse(await readFile(seedPath, 'utf8')) as Array<{
    name: string;
    questionCount: number;
    isStock: true;
    schemaVersion: number;
    geometry: unknown;
  }>;

  const client = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(client);
    for (const record of seedRecords) {
      await db
        .insert(templates)
        .values({
          ownerId: null,
          name: record.name,
          questionCount: record.questionCount,
          geometry: record.geometry,
          isStock: record.isStock,
          schemaVersion: record.schemaVersion,
        })
        .onConflictDoUpdate({
          target: templates.name,
          targetWhere: sql`${templates.isStock} = true`,
          set: {
            questionCount: record.questionCount,
            geometry: record.geometry,
            schemaVersion: record.schemaVersion,
            updatedAt: sql`now()`,
          },
        });
    }
    return seedRecords.length;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to seed stock templates.');
    process.exit(1);
  }
  seedStockTemplates(databaseUrl)
    .then((count) => {
      console.log(`Seeded ${count} stock templates.`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}

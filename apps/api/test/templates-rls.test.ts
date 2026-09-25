import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { withTenantContext } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { templates, users } from '../src/db/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * M2-002's RLS proof for `templates` — genuinely different from
 * `rls.test.ts`'s `users` proof, not a copy of it: this table has to
 * prove *both* that a stock template (`owner_id IS NULL`) is visible to
 * every tenant, *and* that a custom template stays isolated the same way
 * `users` rows do, *and* that the app role can never write a stock row
 * at all (only the privileged seed script can, per `schema.ts`'s policy
 * doc comment) — three properties `users`' single "row belongs to you"
 * policy never had to distinguish.
 *
 * Skipped (not failed) without a real Postgres — see `rls.test.ts` for
 * why this sandbox can't run it locally, only CI can.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('Postgres RLS: templates table', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
  const appDb = drizzle(appClient, { schema });

  const tenantA = { id: randomUUID(), email: `templates-tenant-a-${randomUUID()}@example.com` };
  const tenantB = { id: randomUUID(), email: `templates-tenant-b-${randomUUID()}@example.com` };
  const stockTemplateId = randomUUID();
  const tenantACustomTemplateId = randomUUID();

  const minimalGeometry = { schemaVersion: 1, note: 'fixture, not real geometry' };

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
    const ownerDb = drizzle(ownerClient, { schema: { users, templates } });
    await ownerDb.insert(users).values([
      { id: tenantA.id, email: tenantA.email, authMode: 'google' },
      { id: tenantB.id, email: tenantB.email, authMode: 'google' },
    ]);
    await ownerDb.insert(templates).values([
      {
        id: stockTemplateId,
        ownerId: null,
        name: `RLS-test stock template ${stockTemplateId}`,
        questionCount: 20,
        geometry: minimalGeometry,
        isStock: true,
      },
      {
        id: tenantACustomTemplateId,
        ownerId: tenantA.id,
        name: 'Tenant A custom template',
        questionCount: 20,
        geometry: minimalGeometry,
        isStock: false,
      },
    ]);
  });

  afterAll(async () => {
    await ownerClient`DELETE FROM templates WHERE id IN (${stockTemplateId}, ${tenantACustomTemplateId})`;
    await ownerClient`DELETE FROM templates WHERE owner_id IN (${tenantA.id}, ${tenantB.id})`;
    await ownerClient`DELETE FROM users WHERE id IN (${tenantA.id}, ${tenantB.id})`;
    await ownerClient.end();
    await appClient.end();
  });

  it('lets any tenant read a stock template (owner_id is null)', async () => {
    const rowsForA = await withTenantContext(appDb, tenantA.id, (tx) =>
      tx.select().from(templates).where(eq(templates.id, stockTemplateId)),
    );
    const rowsForB = await withTenantContext(appDb, tenantB.id, (tx) =>
      tx.select().from(templates).where(eq(templates.id, stockTemplateId)),
    );
    expect(rowsForA).toHaveLength(1);
    expect(rowsForB).toHaveLength(1);
  });

  it('lets tenant A read their own custom template', async () => {
    const rows = await withTenantContext(appDb, tenantA.id, (tx) =>
      tx.select().from(templates).where(eq(templates.id, tenantACustomTemplateId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Tenant A custom template');
  });

  it("blocks tenant B from reading tenant A's custom template", async () => {
    const rows = await withTenantContext(appDb, tenantB.id, (tx) =>
      tx.select().from(templates).where(eq(templates.id, tenantACustomTemplateId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('lets tenant A insert their own custom template', async () => {
    const newId = randomUUID();
    await withTenantContext(appDb, tenantA.id, (tx) =>
      tx.insert(templates).values({
        id: newId,
        ownerId: tenantA.id,
        name: 'A second tenant A template',
        questionCount: 20,
        geometry: minimalGeometry,
        isStock: false,
      }),
    );
    const rows = await withTenantContext(appDb, tenantA.id, (tx) =>
      tx.select().from(templates).where(eq(templates.id, newId)),
    );
    expect(rows).toHaveLength(1);
    await ownerClient`DELETE FROM templates WHERE id = ${newId}`;
  });

  it('blocks tenant A from inserting a stock template (owner_id null) through the app role', async () => {
    const attemptedId = randomUUID();
    await expect(
      withTenantContext(appDb, tenantA.id, (tx) =>
        tx.insert(templates).values({
          id: attemptedId,
          ownerId: null,
          name: 'Attempted stock template via app role',
          questionCount: 20,
          geometry: minimalGeometry,
          isStock: true,
        }),
      ),
    ).rejects.toThrow();

    const rows = await ownerClient`SELECT 1 FROM templates WHERE id = ${attemptedId}`;
    expect(rows).toHaveLength(0);
  });

  it('blocks tenant A from updating or deleting the stock template', async () => {
    await withTenantContext(appDb, tenantA.id, (tx) =>
      tx.update(templates).set({ name: 'tampered' }).where(eq(templates.id, stockTemplateId)),
    );
    await withTenantContext(appDb, tenantA.id, (tx) =>
      tx.delete(templates).where(eq(templates.id, stockTemplateId)),
    );

    const rows = await ownerClient`SELECT name FROM templates WHERE id = ${stockTemplateId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).not.toBe('tampered');
  });

  it("blocks tenant B from updating or deleting tenant A's custom template", async () => {
    await withTenantContext(appDb, tenantB.id, (tx) =>
      tx
        .update(templates)
        .set({ name: 'tampered by B' })
        .where(eq(templates.id, tenantACustomTemplateId)),
    );
    await withTenantContext(appDb, tenantB.id, (tx) =>
      tx.delete(templates).where(eq(templates.id, tenantACustomTemplateId)),
    );

    const rows =
      await ownerClient`SELECT name FROM templates WHERE id = ${tenantACustomTemplateId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Tenant A custom template');
  });
});

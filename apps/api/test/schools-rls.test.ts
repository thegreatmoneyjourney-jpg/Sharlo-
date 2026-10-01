import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { withTenantContext } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { schools, users } from '../src/db/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * `M3-014`'s RLS proof for `schools` — a single `for: 'all'` policy (no
 * own-or-stock split like `templates`'), so this mirrors `rls.test.ts`'s
 * `users` shape: an admin can fully manage their own school row, a
 * different tenant can't see or touch it at all.
 *
 * Skipped (not failed) without a real Postgres — see `rls.test.ts` for why.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('Postgres RLS: schools table', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
  const appDb = drizzle(appClient, { schema });

  const adminA = { id: randomUUID(), email: `schools-admin-a-${randomUUID()}@example.com` };
  const adminB = { id: randomUUID(), email: `schools-admin-b-${randomUUID()}@example.com` };
  const schoolAId = randomUUID();

  function fixtureSchool(overrides: Partial<typeof schools.$inferInsert> = {}) {
    return {
      id: schoolAId,
      name: 'RLS-test school',
      adminUserId: adminA.id,
      driveLocationType: 'folder' as const,
      driveLocationId: 'fixture-drive-folder-id',
      schoolWrappedKeyByAdminMasterKey: 'fixture-ciphertext-not-real',
      adminX25519PublicKey: 'fixture-public-key-not-real',
      adminX25519WrappedPrivateKey: 'fixture-ciphertext-not-real',
      ...overrides,
    };
  }

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
    const ownerDb = drizzle(ownerClient, { schema: { users, schools } });
    await ownerDb.insert(users).values([
      { id: adminA.id, email: adminA.email, authMode: 'google', authProvider: 'google' },
      { id: adminB.id, email: adminB.email, authMode: 'google', authProvider: 'google' },
    ]);
    await ownerDb.insert(schools).values(fixtureSchool());
  });

  afterAll(async () => {
    await ownerClient`DELETE FROM schools WHERE id = ${schoolAId}`;
    await ownerClient`DELETE FROM schools WHERE admin_user_id IN (${adminA.id}, ${adminB.id})`;
    await ownerClient`DELETE FROM users WHERE id IN (${adminA.id}, ${adminB.id})`;
    await ownerClient.end();
    await appClient.end();
  });

  it('lets the admin read their own school', async () => {
    const rows = await withTenantContext(appDb, adminA.id, (tx) =>
      tx.select().from(schools).where(eq(schools.id, schoolAId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('RLS-test school');
  });

  it("blocks a different tenant from reading another admin's school", async () => {
    const rows = await withTenantContext(appDb, adminB.id, (tx) =>
      tx.select().from(schools).where(eq(schools.id, schoolAId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('lets the admin insert their own school', async () => {
    const newId = randomUUID();
    await withTenantContext(appDb, adminA.id, (tx) =>
      tx.insert(schools).values(fixtureSchool({ id: newId, name: 'A second school' })),
    );
    const rows = await withTenantContext(appDb, adminA.id, (tx) =>
      tx.select().from(schools).where(eq(schools.id, newId)),
    );
    expect(rows).toHaveLength(1);
    await ownerClient`DELETE FROM schools WHERE id = ${newId}`;
  });

  it('blocks a tenant from inserting a school under a different admin_user_id', async () => {
    const attemptedId = randomUUID();
    await expect(
      withTenantContext(appDb, adminB.id, (tx) =>
        tx
          .insert(schools)
          .values(fixtureSchool({ id: attemptedId, adminUserId: adminA.id, name: 'Spoofed' })),
      ),
    ).rejects.toThrow();

    const rows = await ownerClient`SELECT 1 FROM schools WHERE id = ${attemptedId}`;
    expect(rows).toHaveLength(0);
  });

  it("blocks a different tenant from updating or deleting another admin's school", async () => {
    await withTenantContext(appDb, adminB.id, (tx) =>
      tx.update(schools).set({ name: 'tampered by B' }).where(eq(schools.id, schoolAId)),
    );
    await withTenantContext(appDb, adminB.id, (tx) =>
      tx.delete(schools).where(eq(schools.id, schoolAId)),
    );

    const rows = await ownerClient`SELECT name FROM schools WHERE id = ${schoolAId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('RLS-test school');
  });
});

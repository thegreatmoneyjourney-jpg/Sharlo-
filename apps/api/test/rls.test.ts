import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { withTenantContext } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * This is the M0-006 "done when" proof: a session authenticated as tenant A
 * cannot read a row seeded for tenant B, enforced by Postgres itself (RLS),
 * not by an application-layer WHERE clause that a future handler could
 * forget (ADR-0008).
 *
 * Requires a real Postgres reachable at DATABASE_URL (owner/migration role)
 * and APP_DATABASE_URL (the restricted app_user role, same database).
 * Skipped — not failed — when those aren't set, since this sandbox has no
 * local Postgres/Docker daemon available; CI provides both via a service
 * container (.github/workflows/ci.yml). See docs/reports/SHARLO-M0-006.md
 * for why this couldn't be verified locally this session, only in CI.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)(
  'Postgres RLS: users table tenant isolation',
  () => {
    const ownerClient = postgres(DATABASE_URL!, { max: 1 });
    const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
    const appDb = drizzle(appClient, { schema: { users } });

    const tenantA = { id: randomUUID(), email: `tenant-a-${randomUUID()}@example.com` };
    const tenantB = { id: randomUUID(), email: `tenant-b-${randomUUID()}@example.com` };

    beforeAll(async () => {
      await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
      const ownerDb = drizzle(ownerClient, { schema: { users } });
      await ownerDb.insert(users).values([
        { id: tenantA.id, email: tenantA.email, authMode: 'google' },
        { id: tenantB.id, email: tenantB.email, authMode: 'google' },
      ]);
    });

    afterAll(async () => {
      await ownerClient`DELETE FROM users WHERE id IN (${tenantA.id}, ${tenantB.id})`;
      await ownerClient.end();
      await appClient.end();
    });

    it('lets tenant A read their own row', async () => {
      const rows = await withTenantContext(appDb, tenantA.id, (tx) =>
        tx.select().from(users).where(eq(users.id, tenantA.id)),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.email).toBe(tenantA.email);
    });

    it("blocks tenant A from reading tenant B's row, even by direct id lookup", async () => {
      const rows = await withTenantContext(appDb, tenantA.id, (tx) =>
        tx.select().from(users).where(eq(users.id, tenantB.id)),
      );
      expect(rows).toHaveLength(0);
    });

    it('blocks an unscoped query (no tenant context set) from seeing any row — fails closed', async () => {
      // Deliberately not using withTenantContext: no app.current_user_id is
      // ever set on this connection, proving ADR-0008's "missing context
      // means zero rows, not every row" claim rather than just asserting it.
      const rows = await appDb.select().from(users);
      expect(rows).toHaveLength(0);
    });
  },
);

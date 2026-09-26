import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { withTenantContext } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
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
    const appDb = drizzle(appClient, { schema });

    const tenantA = { id: randomUUID(), email: `tenant-a-${randomUUID()}@example.com` };
    const tenantB = { id: randomUUID(), email: `tenant-b-${randomUUID()}@example.com` };

    beforeAll(async () => {
      await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
      const ownerDb = drizzle(ownerClient, { schema: { users } });
      await ownerDb.insert(users).values([
        { id: tenantA.id, email: tenantA.email, authMode: 'google', authProvider: 'google' },
        { id: tenantB.id, email: tenantB.email, authMode: 'google', authProvider: 'google' },
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

    it('blocks an unscoped query from seeing any row — fails closed, even on a pooled connection previously used by another tenant', async () => {
      // Deliberately not using withTenantContext, and deliberately running
      // this on `appDb`'s shared pool *after* the two tests above already
      // used it inside a SET LOCAL-scoped transaction — this is the realistic
      // failure mode (a pooled connection whose custom GUC has been touched
      // before, per schema.ts's policy comment), not just a pristine
      // never-used connection. This is exactly what caught the original bug
      // here: current_setting(..., true) alone returns '' in this scenario,
      // not NULL, and a naive ::uuid cast on it throws instead of denying.
      const rows = await appDb.select().from(users);
      expect(rows).toHaveLength(0);
    });
  },
);

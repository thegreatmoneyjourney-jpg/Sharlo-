import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { users } from '../src/db/schema.js';
import { createSession, destroySession, validateSessionToken } from '../src/auth/session.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * M3-002 "done when": a session survives a lookup by its cookie token,
 * and — the RLS-specific proof this table's novel policy shape needs
 * (schema.ts's doc comment) — an unscoped query still sees nothing, and a
 * lookup scoped to the *wrong* token sees nothing either. Same real-
 * Postgres-via-CI pattern as `rls.test.ts`/`integration-credentials.test.ts`.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)(
  'session: create/validate/destroy + RLS',
  () => {
    const ownerClient = postgres(DATABASE_URL!, { max: 1 });
    const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
    const appDb = drizzle(appClient, { schema });
    const testUser = { id: randomUUID(), email: `session-test-${randomUUID()}@example.com` };

    beforeAll(async () => {
      await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
      const ownerDb = drizzle(ownerClient, { schema: { users } });
      await ownerDb.insert(users).values({
        id: testUser.id,
        email: testUser.email,
        authMode: 'google',
        authProvider: 'google',
      });
    });

    afterAll(async () => {
      await ownerClient`DELETE FROM sessions WHERE user_id = ${testUser.id}`;
      await ownerClient`DELETE FROM users WHERE id = ${testUser.id}`;
      await ownerClient.end();
      await appClient.end();
    });

    it('creates a session and validates it back by its token', async () => {
      const session = await createSession(appDb, testUser.id);
      expect(session.token).toBeTruthy();
      expect(session.csrfToken).toBeTruthy();
      expect(session.csrfToken).not.toBe(session.token);

      const validated = await validateSessionToken(appDb, session.token);
      expect(validated).not.toBeNull();
      expect(validated?.userId).toBe(testUser.id);
      expect(validated?.csrfToken).toBe(session.csrfToken);
    });

    it('returns null for a token that was never issued', async () => {
      expect(await validateSessionToken(appDb, 'this-token-does-not-exist')).toBeNull();
    });

    it('returns null for an expired session, even though the row still exists', async () => {
      const session = await createSession(appDb, testUser.id);
      await ownerClient`UPDATE sessions SET expires_at = now() - interval '1 day' WHERE token = ${session.token}`;

      expect(await validateSessionToken(appDb, session.token)).toBeNull();

      const rawRow = await ownerClient`SELECT 1 FROM sessions WHERE token = ${session.token}`;
      expect(rawRow).toHaveLength(1);
    });

    it('destroySession removes the row; the token no longer validates', async () => {
      const session = await createSession(appDb, testUser.id);
      await destroySession(appDb, testUser.id, session.token);
      expect(await validateSessionToken(appDb, session.token)).toBeNull();
    });

    it("RLS fails closed: looking up session A's token never returns session B's row", async () => {
      const sessionA = await createSession(appDb, testUser.id);
      const sessionB = await createSession(appDb, testUser.id);

      const rows = await appDb.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.session_lookup_token', ${sessionA.token}, true)`,
        );
        return tx.select().from(schema.sessions);
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.token).toBe(sessionA.token);
      expect(rows.some((r) => r.token === sessionB.token)).toBe(false);
    });

    it('RLS fails closed: an unscoped query (no lookup token set at all) sees zero session rows', async () => {
      await createSession(appDb, testUser.id);
      const rows = await appDb.select().from(schema.sessions);
      expect(rows).toHaveLength(0);
    });
  },
);

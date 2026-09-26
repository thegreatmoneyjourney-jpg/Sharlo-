import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { withTenantContext } from '../db/client.js';
import { users } from '../db/schema.js';
import type * as schema from '../db/schema.js';

type Db = PostgresJsDatabase<typeof schema>;

export interface AccountInfo {
  authMode: 'google' | 'local_only';
}

/**
 * `M3-005` — the client-side signal for "is this a local-only account,"
 * needed by the persistent data-loss warning banner (FR-AUTH-06) and the
 * `/settings` backup card, both of which have to render correctly before
 * (and regardless of whether) encryption setup has completed — unlike
 * `encryption-params`, this never returns "not set up," since `authMode`
 * is written at account creation (`user-account.ts`/`email-otp.ts`), not
 * at encryption setup time.
 */
export async function getAccountInfo(db: Db, userId: string): Promise<AccountInfo> {
  const rows = await withTenantContext(db, userId, (tx) =>
    tx.select({ authMode: users.authMode }).from(users).where(eq(users.id, userId)),
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`getAccountInfo: no users row for authenticated session userId=${userId}`);
  }
  return { authMode: row.authMode };
}

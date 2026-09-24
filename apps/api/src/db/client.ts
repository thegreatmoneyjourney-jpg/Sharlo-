import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';

/**
 * Connects as the restricted `app_user` role (ARCHITECTURE.md §8) — never
 * the migration/owner role, which Postgres exempts from RLS by default
 * regardless of policies. This is the connection every request handler uses.
 */
export function createAppDb(connectionString: string): PostgresJsDatabase<typeof schema> {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

/**
 * Sets the session's tenant claim for the lifetime of one transaction, then
 * runs `fn` inside it. `SET LOCAL` (not `SET`) so the claim can never leak
 * across pooled-connection reuse into an unrelated request.
 */
export async function withTenantContext<T>(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
    return fn(tx as unknown as PostgresJsDatabase<typeof schema>);
  });
}

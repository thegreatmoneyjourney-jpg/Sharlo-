import type { FastifyInstance } from 'fastify';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema.js';
import { requireSession } from '../auth/request-session.js';
import { getAccountInfo } from '../auth/account.js';

type Db = PostgresJsDatabase<typeof schema>;

export interface AccountRoutesOptions {
  db: Db;
}

/**
 * `M3-005` — general account info, separate from `routes/encryption.ts`
 * (which is scoped to encryption/Recovery-Key concerns specifically) and
 * from `routes/email-otp.ts` (which is scoped to the pre-session sign-in
 * handshake). A read-only GET, no CSRF wiring needed (safe method).
 */
export async function accountRoutes(
  app: FastifyInstance,
  opts: AccountRoutesOptions,
): Promise<void> {
  const { db } = opts;

  app.get('/account/me', async (req, reply) => {
    const session = await requireSession(req, reply, db);
    if (!session) return;

    const info = await getAccountInfo(db, session.userId);
    return reply.code(200).send(info);
  });
}

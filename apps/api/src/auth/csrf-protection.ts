import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema.js';
import { CSRF_HEADER_NAME, getRequestSession } from './request-session.js';
import { csrfTokensMatch } from './csrf.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * `ARCHITECTURE.md` §9's double-submit check, enforced globally: any
 * request that (a) carries a valid session cookie and (b) uses a
 * state-changing HTTP method must also carry a matching `X-CSRF-Token`
 * header — read by client-side JS from the non-httpOnly `sharlo_csrf`
 * cookie `session.ts` issues alongside the session, then echoed back.
 * `SameSite=Lax` on the session cookie already blocks most cross-site
 * POSTs in modern browsers; this is the explicit defense-in-depth layer
 * on top the architecture doc calls for, not a redundant addition invented
 * here.
 *
 * Deliberately does **not** reject a request with no session cookie, or
 * an invalid/expired one — there's no ambient authority to abuse in
 * either case, so that's a plain authentication concern for the specific
 * route to enforce (none of the routes built so far need it — `/health`
 * and the two `/auth/google/*` GET routes are all safe-method/pre-session
 * by nature), not this hook's job.
 */
export function registerCsrfProtection(
  app: FastifyInstance,
  db: PostgresJsDatabase<typeof schema>,
): void {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (SAFE_METHODS.has(req.method)) {
      return;
    }
    const session = await getRequestSession(req, db);
    if (!session) {
      return;
    }
    const headerValue = req.headers[CSRF_HEADER_NAME];
    const csrfHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!csrfTokensMatch(session.csrfToken, csrfHeader)) {
      reply.code(403).send({ error: 'csrf_token_mismatch' });
    }
  });
}

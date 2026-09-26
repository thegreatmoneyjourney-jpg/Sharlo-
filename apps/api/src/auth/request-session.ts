import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema.js';
import { validateSessionToken, type SessionRecord } from './session.js';

export const SESSION_COOKIE_NAME = 'sharlo_session';
export const CSRF_COOKIE_NAME = 'sharlo_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Reads, unsigns, and validates the session cookie on an incoming request —
 * the one path every session-aware route or hook should use, so cookie
 * signing/lookup logic lives in exactly one place rather than being
 * re-implemented per call site.
 */
export async function getRequestSession(
  req: FastifyRequest,
  db: PostgresJsDatabase<typeof schema>,
): Promise<SessionRecord | null> {
  const raw = req.cookies[SESSION_COOKIE_NAME];
  if (!raw) {
    return null;
  }
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) {
    return null;
  }
  return validateSessionToken(db, unsigned.value);
}

/**
 * `getRequestSession`, plus the 401 a route should send on a missing/
 * invalid session — the first consumer being `../routes/encryption.ts`
 * (`M3-003`), the first real session-authenticated route this app has
 * beyond the OAuth handshake itself. A route calls this once at the top
 * and returns immediately when it gets `null` back; the reply has already
 * been sent in that case.
 */
export async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
  db: PostgresJsDatabase<typeof schema>,
): Promise<SessionRecord | null> {
  const session = await getRequestSession(req, db);
  if (!session) {
    await reply.code(401).send({ error: 'unauthenticated' });
    return null;
  }
  return session;
}

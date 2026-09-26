import type { FastifyRequest } from 'fastify';
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

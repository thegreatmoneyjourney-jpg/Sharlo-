import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { withSessionLookupContext, withTenantContext } from '../db/client.js';
import { sessions } from '../db/schema.js';
import type * as schema from '../db/schema.js';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * No NFR/SRS requirement pins an exact session lifetime — 30 days is a
 * reasonable default for this product (infrequent, low-stakes sign-in
 * relative to a banking app), chosen here rather than left unspecified.
 * Revisit if the founder wants a different value; nothing else depends on
 * this specific number.
 */
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionRecord {
  token: string;
  userId: string;
  csrfToken: string;
  expiresAt: Date;
}

/** Issues a new session for an already-authenticated user (post-OAuth-callback, or a future local-only login). */
export async function createSession(db: Db, userId: string): Promise<SessionRecord> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await withTenantContext(db, userId, (tx) =>
    tx.insert(sessions).values({ token, userId, csrfToken, expiresAt }),
  );

  return { token, userId, csrfToken, expiresAt };
}

/**
 * Looks up a session by its raw cookie token. Returns `null` for anything
 * that isn't a currently-valid session (not found, or found but expired) —
 * callers only need "is this request authenticated," not why not.
 *
 * Expired rows aren't actively deleted here or by a background job yet —
 * a deliberate v1 simplification (same "don't build it before something
 * needs it" judgment as the capacity dashboard's metrics design): treating
 * `expiresAt <= now` as invalid is sufficient for correctness, and nothing
 * currently depends on expired rows being physically removed promptly.
 */
export async function validateSessionToken(db: Db, token: string): Promise<SessionRecord | null> {
  const rows = await withSessionLookupContext(db, token, (tx) =>
    tx.select().from(sessions).where(eq(sessions.token, token)),
  );
  const row = rows[0];
  if (!row || row.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return {
    token: row.token,
    userId: row.userId,
    csrfToken: row.csrfToken,
    expiresAt: row.expiresAt,
  };
}

/** Logs out one specific session (the current device/browser only — never every session for a user). */
export async function destroySession(db: Db, userId: string, token: string): Promise<void> {
  await withTenantContext(db, userId, (tx) => tx.delete(sessions).where(eq(sessions.token, token)));
}

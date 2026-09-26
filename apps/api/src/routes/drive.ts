import type { FastifyInstance } from 'fastify';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema.js';
import { requireSession } from '../auth/request-session.js';
import {
  GoogleTokenRefreshError,
  mintDriveAccessToken,
  NoGoogleRefreshTokenError,
} from '../auth/drive-access.js';
import { refreshAccessToken as defaultRefreshAccessToken } from '../auth/google-oauth.js';

type Db = PostgresJsDatabase<typeof schema>;

export interface DriveRoutesOptions {
  db: Db;
  /** Injectable seam for tests — real Google network calls by default, matching `authRoutes`' own `googleOAuthClient` pattern. */
  refreshAccessToken?: typeof defaultRefreshAccessToken;
}

/**
 * `M3-006` — session-authenticated (covered by the global CSRF hook,
 * same as every other mutating session-bearing route in this app; POST
 * because it triggers a real Google API call and returns a live
 * credential, not because it changes server state).
 */
export async function driveRoutes(app: FastifyInstance, opts: DriveRoutesOptions): Promise<void> {
  const { db } = opts;
  const refreshAccessToken = opts.refreshAccessToken ?? defaultRefreshAccessToken;

  app.post('/account/drive-access-token', async (req, reply) => {
    const session = await requireSession(req, reply, db);
    if (!session) return;

    try {
      const token = await mintDriveAccessToken(db, session.userId, refreshAccessToken);
      return reply.code(200).send(token);
    } catch (error) {
      if (error instanceof NoGoogleRefreshTokenError) {
        return reply.code(409).send({ error: 'no_google_account' });
      }
      if (error instanceof GoogleTokenRefreshError) {
        return reply.code(502).send({ error: 'google_token_refresh_failed' });
      }
      throw error;
    }
  });
}

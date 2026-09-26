import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { withTenantContext } from '../db/client.js';
import { users } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import { decryptCredentialValue, getCredential } from '../integrations/credential-store.js';
import { refreshAccessToken as defaultRefreshAccessToken } from './google-oauth.js';

type Db = PostgresJsDatabase<typeof schema>;

/** No refresh token stored for this account — a local-only account calling this, or (shouldn't happen given `access_type=offline`+`prompt=consent`) a Google account that never got one. */
export class NoGoogleRefreshTokenError extends Error {
  constructor() {
    super('This account has no stored Google refresh token to mint a Drive access token from.');
    this.name = 'NoGoogleRefreshTokenError';
  }
}

/** Google's refresh grant itself failed — most likely the teacher revoked our app's access from their Google account settings. */
export class GoogleTokenRefreshError extends Error {
  constructor(cause: unknown) {
    super('Refreshing the Google Drive access token failed.');
    this.name = 'GoogleTokenRefreshError';
    this.cause = cause;
  }
}

export interface DriveAccessToken {
  accessToken: string;
  expiresInSeconds: number;
}

/**
 * `M3-006` — the endpoint `M3-001`'s own report forward-referenced: gives
 * the browser a fresh, short-lived (`drive.file`-scoped, inherited from
 * the original consent grant) Drive access token, so it can talk to
 * Drive's REST API directly (`ADR-0004`'s "zero backend involvement in
 * the request path" — this mint is the one, brief exception, not a
 * proxy for the actual file operations that follow it). The refresh
 * token itself never leaves this function.
 */
export async function mintDriveAccessToken(
  db: Db,
  userId: string,
  refreshAccessTokenImpl: typeof defaultRefreshAccessToken = defaultRefreshAccessToken,
): Promise<DriveAccessToken> {
  const rows = await withTenantContext(db, userId, (tx) =>
    tx
      .select({ googleRefreshTokenEncrypted: users.googleRefreshTokenEncrypted })
      .from(users)
      .where(eq(users.id, userId)),
  );
  const encrypted = rows[0]?.googleRefreshTokenEncrypted;
  if (!encrypted) {
    throw new NoGoogleRefreshTokenError();
  }
  const refreshToken = decryptCredentialValue(encrypted);

  const clientId = await getCredential(db, 'google_oauth', 'client_id');
  const clientSecret = await getCredential(db, 'google_oauth', 'client_secret');

  try {
    const refreshed = await refreshAccessTokenImpl({ clientId, clientSecret, refreshToken });
    return { accessToken: refreshed.access_token, expiresInSeconds: refreshed.expires_in };
  } catch (error) {
    throw new GoogleTokenRefreshError(error);
  }
}

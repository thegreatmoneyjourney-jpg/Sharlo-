import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { users } from '../src/db/schema.js';
import { encryptCredentialValue, setCredential } from '../src/integrations/credential-store.js';
import {
  GoogleTokenRefreshError,
  mintDriveAccessToken,
  NoGoogleRefreshTokenError,
} from '../src/auth/drive-access.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * `M3-006` — `mintDriveAccessToken`'s own logic: reads and decrypts the
 * stored refresh token, reads the `google_oauth` credentials, and calls
 * an injected refresh implementation (this project has no real Google
 * OAuth credentials anywhere, sandbox or CI — see `docs/reports/SHARLO-M3-006.md`
 * for what that does and doesn't prove).
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('mintDriveAccessToken', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
  const appDb = drizzle(appClient, { schema });

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
    await setCredential(appDb, 'google_oauth', 'client_id', 'test-google-client-id');
    await setCredential(appDb, 'google_oauth', 'client_secret', 'test-google-client-secret');
  });

  afterAll(async () => {
    await ownerClient.end();
    await appClient.end();
  });

  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds) {
      await ownerClient`DELETE FROM users WHERE id = ${id}`;
    }
    createdUserIds.length = 0;
  });

  async function seedGoogleUser(refreshToken: string | null) {
    const id = randomUUID();
    createdUserIds.push(id);
    const ownerDb = drizzle(ownerClient, { schema: { users } });
    await ownerDb.insert(users).values({
      id,
      email: `drive-access-test-${id}@example.com`,
      authMode: 'google',
      authProvider: 'google',
      googleRefreshTokenEncrypted: refreshToken ? encryptCredentialValue(refreshToken) : null,
    });
    return id;
  }

  it('mints an access token using the decrypted refresh token and stored client credentials', async () => {
    const userId = await seedGoogleUser('real-refresh-token-value');
    const refreshAccessTokenMock = vi.fn().mockResolvedValue({
      access_token: 'fresh-access-token',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/drive.file',
      token_type: 'Bearer',
    });

    const result = await mintDriveAccessToken(appDb, userId, refreshAccessTokenMock);

    expect(result).toEqual({ accessToken: 'fresh-access-token', expiresInSeconds: 3600 });
    expect(refreshAccessTokenMock).toHaveBeenCalledWith({
      clientId: 'test-google-client-id',
      clientSecret: 'test-google-client-secret',
      refreshToken: 'real-refresh-token-value',
    });
  });

  it('throws NoGoogleRefreshTokenError for an account with no stored refresh token', async () => {
    const userId = await seedGoogleUser(null);
    await expect(mintDriveAccessToken(appDb, userId, vi.fn())).rejects.toThrow(
      NoGoogleRefreshTokenError,
    );
  });

  it('throws GoogleTokenRefreshError, not a raw error, when the refresh call itself fails (e.g. revoked access)', async () => {
    const userId = await seedGoogleUser('a-now-revoked-refresh-token');
    const refreshAccessTokenMock = vi.fn().mockRejectedValue(new Error('invalid_grant'));

    await expect(mintDriveAccessToken(appDb, userId, refreshAccessTokenMock)).rejects.toThrow(
      GoogleTokenRefreshError,
    );
  });
});

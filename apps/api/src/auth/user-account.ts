import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { withGoogleSubLookupContext, withTenantContext } from '../db/client.js';
import { users } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import { encryptCredentialValue } from '../integrations/credential-store.js';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Finds the existing account for this Google subject id, or creates one.
 *
 * The id for a brand-new row is generated *here*, in application code
 * (`randomUUID()`), rather than left to the column's own `defaultRandom()` —
 * on purpose: `users`' RLS policy requires `id = current_user_id` on
 * INSERT (there's no separate WITH CHECK, so the SELECT/UPDATE/DELETE
 * predicate governs INSERT too), and the only way to satisfy that for a
 * row that doesn't exist yet is to already know its id before the insert,
 * so `withTenantContext` can set `current_user_id` to the *same* id the
 * row is about to get. Letting Postgres pick the id would make every
 * first-time Google sign-in fail closed against its own account's RLS
 * policy — a real gap `M0-006`'s original RLS proof never exercised (it
 * only ever read fixture rows seeded through the privileged connection,
 * never inserted a new one through the restricted one) — see
 * `docs/reports/SHARLO-M3-001.md` for the full story.
 */
export async function findOrCreateUserByGoogleIdentity(
  db: Db,
  identity: { googleSub: string; email: string },
  refreshToken: string | undefined,
): Promise<{ id: string }> {
  const existingRows = await withGoogleSubLookupContext(db, identity.googleSub, (tx) =>
    tx.select({ id: users.id }).from(users).where(eq(users.googleSub, identity.googleSub)),
  );
  const existing = existingRows[0];

  if (existing) {
    if (refreshToken) {
      await withTenantContext(db, existing.id, (tx) =>
        tx
          .update(users)
          .set({
            googleRefreshTokenEncrypted: encryptCredentialValue(refreshToken),
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id)),
      );
    }
    return { id: existing.id };
  }

  const newUserId = randomUUID();
  await withTenantContext(db, newUserId, (tx) =>
    tx.insert(users).values({
      id: newUserId,
      email: identity.email,
      googleSub: identity.googleSub,
      authMode: 'google',
      authProvider: 'google',
      googleRefreshTokenEncrypted: refreshToken ? encryptCredentialValue(refreshToken) : null,
    }),
  );
  return { id: newUserId };
}

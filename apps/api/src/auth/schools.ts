import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { withTenantContext } from '../db/client.js';
import { schools, users } from '../db/schema.js';
import type * as schema from '../db/schema.js';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * `M3-014`/`ADR-0010` — this module only ever stores or returns opaque
 * ciphertext, hex-encoded public-key bytes, and a Drive resource id it
 * never interprets. Every actual cryptographic operation (school-key
 * generation, the admin's X25519 keypair, wrapping both under the admin's
 * already-unlocked master key) happens client-side in
 * `apps/web/lib/crypto/school-key.ts`; the route layer validates shape
 * with Zod before anything reaches here, matching `account-encryption.ts`'s
 * own established division of labor.
 */

export type DriveLocationType = 'shared_drive' | 'folder';

export interface CreateSchoolInput {
  name: string;
  driveLocationType: DriveLocationType;
  driveLocationId: string;
  schoolWrappedKeyByAdminMasterKey: string;
  adminX25519PublicKey: string;
  adminX25519WrappedPrivateKey: string;
}

export interface SchoolSummary {
  id: string;
  name: string;
  driveLocationType: DriveLocationType;
  driveLocationId: string;
}

const schoolSummaryColumns = {
  id: schools.id,
  name: schools.name,
  driveLocationType: schools.driveLocationType,
  driveLocationId: schools.driveLocationId,
};

/**
 * Creates a school for the signed-in admin and promotes their account to
 * `accountType: 'school_admin'` — the only place that transition happens.
 * Both writes share the one `withTenantContext` transaction, so a crash
 * between them can't leave a school row behind whose creator's account
 * never actually flipped to `school_admin`.
 */
export async function createSchool(
  db: Db,
  adminUserId: string,
  input: CreateSchoolInput,
): Promise<SchoolSummary> {
  return withTenantContext(db, adminUserId, async (tx) => {
    const [row] = await tx
      .insert(schools)
      .values({
        name: input.name,
        adminUserId,
        driveLocationType: input.driveLocationType,
        driveLocationId: input.driveLocationId,
        schoolWrappedKeyByAdminMasterKey: input.schoolWrappedKeyByAdminMasterKey,
        adminX25519PublicKey: input.adminX25519PublicKey,
        adminX25519WrappedPrivateKey: input.adminX25519WrappedPrivateKey,
      })
      .returning(schoolSummaryColumns);
    await tx
      .update(users)
      .set({ accountType: 'school_admin', updatedAt: new Date() })
      .where(eq(users.id, adminUserId));
    return row!;
  });
}

/**
 * Every school this admin has created. Nothing in the product yet lets an
 * admin create a second one, but that's not enforced at the schema level
 * (no uniqueness constraint on `adminUserId`) — list rather than assume
 * singular, so the onboarding flow's own "do you already have a school"
 * check stays correct if that ever changes.
 */
export async function listSchoolsForAdmin(db: Db, adminUserId: string): Promise<SchoolSummary[]> {
  return withTenantContext(db, adminUserId, (tx) =>
    tx.select(schoolSummaryColumns).from(schools).where(eq(schools.adminUserId, adminUserId)),
  );
}

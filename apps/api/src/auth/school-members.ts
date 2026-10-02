import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { withEmailLookupContext, withTenantContext } from '../db/client.js';
import { schoolMembers, schools, users } from '../db/schema.js';
import type * as schema from '../db/schema.js';

type Db = PostgresJsDatabase<typeof schema>;

export interface SchoolMemberSummary {
  id: string;
  userId: string;
  email: string;
  driveAccessGranted: boolean;
}

export type AddTeacherResult =
  | { outcome: 'added'; member: SchoolMemberSummary }
  | { outcome: 'teacher_not_found' }
  | { outcome: 'wrong_auth_provider' }
  | { outcome: 'already_member' }
  | { outcome: 'school_not_found' };

const memberSummaryColumns = {
  id: schoolMembers.id,
  userId: schoolMembers.userId,
  email: schoolMembers.email,
  driveAccessGranted: schoolMembers.driveAccessGranted,
};

/** Postgres SQLSTATE for a unique-constraint violation — same code `provision-app-role.ts` already checks for the identical reason (a real, expected-to-sometimes-happen conflict, not a crash). */
const UNIQUE_VIOLATION = '23505';

/**
 * Adds a teacher to a school by email. Looks the teacher's account up by
 * email *first*, outside any tenant context — the exact same
 * lookup-before-identity shape `M3-005`'s `findOrCreateUserByEmail`
 * already established (reusing `withEmailLookupContext`, not a second
 * GUC/policy pair), since the *target* teacher's account isn't something
 * the admin's own RLS-scoped connection can otherwise see at all.
 *
 * Two real preconditions FR-SCHOOL-02 doesn't spell out, found while
 * building this and documented here rather than guessed past (see
 * `docs/reports/SHARLO-M3-015.md`'s Flags):
 * - The matched account must be `authProvider: 'google'`. Drive-sharing
 *   is specifically a function of having a real Google account
 *   (`ADR-0004`) — an email-OTP/local-only teacher has no Drive access
 *   to grant at all, so adding one here would create a membership row
 *   that can never complete the Picker step. `wrong_auth_provider`
 *   surfaces this clearly rather than silently creating a dead row.
 * - A teacher can only ever be added once, ever, full stop — not just
 *   once per school. `school_members.userId`'s own unique constraint
 *   (`schema.ts`) is the real enforcement; this function can't pre-check
 *   it under the admin's own tenant-scoped connection (RLS hides any
 *   membership row under a *different* admin's school from this query
 *   entirely), so it relies on catching the constraint violation instead
 *   of a racy pre-check-then-insert.
 */
export async function addTeacherToSchool(
  db: Db,
  adminUserId: string,
  schoolId: string,
  teacherEmail: string,
): Promise<AddTeacherResult> {
  const matches = await withEmailLookupContext(db, teacherEmail, (tx) =>
    tx
      .select({ id: users.id, authProvider: users.authProvider })
      .from(users)
      .where(eq(users.email, teacherEmail)),
  );
  const teacher = matches[0];
  if (!teacher) {
    return { outcome: 'teacher_not_found' };
  }
  if (teacher.authProvider !== 'google') {
    return { outcome: 'wrong_auth_provider' };
  }

  try {
    return await withTenantContext(db, adminUserId, async (tx) => {
      // The admin's own RLS-scoped read of their own school — confirms
      // ownership and supplies the authoritative Drive-location values to
      // denormalize onto the new member row (never a client-supplied
      // copy — see `schema.ts`'s own doc comment on `schoolMembers`).
      const [school] = await tx
        .select({
          driveLocationType: schools.driveLocationType,
          driveLocationId: schools.driveLocationId,
          adminX25519PublicKey: schools.adminX25519PublicKey,
        })
        .from(schools)
        .where(eq(schools.id, schoolId));
      if (!school) {
        return { outcome: 'school_not_found' };
      }

      const [member] = await tx
        .insert(schoolMembers)
        .values({
          schoolId,
          userId: teacher.id,
          email: teacherEmail,
          driveLocationType: school.driveLocationType,
          driveLocationId: school.driveLocationId,
          adminX25519PublicKey: school.adminX25519PublicKey,
        })
        .returning(memberSummaryColumns);
      return { outcome: 'added', member: member! };
    });
  } catch (err) {
    // drizzle-orm wraps the real `postgres` package error (which carries
    // `.code`) as `DrizzleQueryError`'s `.cause`, not as a property of its
    // own — found by actually hitting this path in `school-members-routes.test.ts`,
    // not assumed; a direct `err.code` check silently never matches and
    // every unique-violation would otherwise escape as an unhandled 500.
    const cause = err instanceof Error ? err.cause : undefined;
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === UNIQUE_VIOLATION) {
      return { outcome: 'already_member' };
    }
    throw err;
  }
}

/** Every member of a school this admin owns — RLS (`school_members_admin_manages_own_school`) scopes this to schools the caller actually admins; a `schoolId` they don't own returns an empty list, not an error. */
export async function listMembersForSchool(
  db: Db,
  adminUserId: string,
  schoolId: string,
): Promise<SchoolMemberSummary[]> {
  return withTenantContext(db, adminUserId, (tx) =>
    tx.select(memberSummaryColumns).from(schoolMembers).where(eq(schoolMembers.schoolId, schoolId)),
  );
}

export interface MyMembership {
  id: string;
  schoolId: string;
  driveLocationType: 'shared_drive' | 'folder';
  driveLocationId: string;
  driveAccessGranted: boolean;
  /** `M3-016` — the admin's X25519 public key, denormalized onto this row at insert time; a teacher's client needs this to seal a school-key copy of an exam result (`sealToPublicKey`). Not a secret (same reasoning as `schools.admin_x25519_public_key` itself). */
  adminX25519PublicKey: string;
}

/** The signed-in teacher's own membership, if they have one — `school_members_self_select` scopes this to exactly their own row, never another teacher's. */
export async function getMembershipForUser(db: Db, userId: string): Promise<MyMembership | null> {
  const rows = await withTenantContext(db, userId, (tx) =>
    tx
      .select({
        id: schoolMembers.id,
        schoolId: schoolMembers.schoolId,
        driveLocationType: schoolMembers.driveLocationType,
        driveLocationId: schoolMembers.driveLocationId,
        driveAccessGranted: schoolMembers.driveAccessGranted,
        adminX25519PublicKey: schoolMembers.adminX25519PublicKey,
      })
      .from(schoolMembers)
      .where(eq(schoolMembers.userId, userId)),
  );
  return rows[0] ?? null;
}

/**
 * Marks the signed-in teacher's own membership as having completed the
 * one-time Google Picker step (`FR-SCHOOL-02`). Deliberately takes no
 * other field — `school_members_self_update`'s `WITH CHECK` only
 * restricts `userId`, not which columns, so this function (not the RLS
 * policy alone) is what actually keeps a teacher's own update narrow,
 * per `schema.ts`'s own doc comment on this table.
 */
export async function confirmDriveAccessGranted(db: Db, userId: string): Promise<void> {
  await withTenantContext(db, userId, (tx) =>
    tx
      .update(schoolMembers)
      .set({ driveAccessGranted: true, updatedAt: new Date() })
      .where(eq(schoolMembers.userId, userId)),
  );
}

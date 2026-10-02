import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { withTenantContext } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { schoolMembers, schools, users } from '../src/db/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * `M3-015`'s RLS proof for `school_members`. `school_members`'
 * admin policy is this codebase's first subquery-based one (every earlier
 * policy compares a column directly to a session GUC) — specifically
 * exercised here against real Postgres, not just reasoned through, since a
 * subquery crossing two RLS-protected tables is exactly the kind of thing
 * that looks right on paper and isn't. (An earlier draft of this task
 * attempted a `schools_select_by_membership` policy on `schools` itself —
 * abandoned after hitting real Postgres's circular-policy-reference
 * rejection, see `schema.ts`'s own doc comment on `schoolMembers`; the
 * last test below confirms `schools` still has no teacher-facing policy.)
 *
 * Skipped (not failed) without a real Postgres — see `rls.test.ts` for why.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('Postgres RLS: school_members table', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
  const appDb = drizzle(appClient, { schema });

  const adminA = { id: randomUUID(), email: `sm-admin-a-${randomUUID()}@example.com` };
  const adminB = { id: randomUUID(), email: `sm-admin-b-${randomUUID()}@example.com` };
  const teacherA1 = { id: randomUUID(), email: `sm-teacher-a1-${randomUUID()}@example.com` };
  const teacherA2 = { id: randomUUID(), email: `sm-teacher-a2-${randomUUID()}@example.com` };
  const teacherB1 = { id: randomUUID(), email: `sm-teacher-b1-${randomUUID()}@example.com` };
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const memberA1Id = randomUUID();
  const memberB1Id = randomUUID();

  function fixtureSchool(id: string, adminUserId: string, name: string) {
    return {
      id,
      name,
      adminUserId,
      driveLocationType: 'folder' as const,
      driveLocationId: `fixture-drive-folder-${id}`,
      schoolWrappedKeyByAdminMasterKey: 'fixture-ciphertext-not-real',
      adminX25519PublicKey: 'fixture-public-key-not-real',
      adminX25519WrappedPrivateKey: 'fixture-ciphertext-not-real',
    };
  }

  function fixtureMember(id: string, schoolId: string, userId: string, email: string) {
    return {
      id,
      schoolId,
      userId,
      email,
      driveLocationType: 'folder' as const,
      driveLocationId: `fixture-drive-folder-${schoolId}`,
      adminX25519PublicKey: 'fixture-public-key-not-real',
    };
  }

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
    const ownerDb = drizzle(ownerClient, { schema: { users, schools, schoolMembers } });
    await ownerDb.insert(users).values([
      { id: adminA.id, email: adminA.email, authMode: 'google', authProvider: 'google' },
      { id: adminB.id, email: adminB.email, authMode: 'google', authProvider: 'google' },
      { id: teacherA1.id, email: teacherA1.email, authMode: 'google', authProvider: 'google' },
      { id: teacherA2.id, email: teacherA2.email, authMode: 'google', authProvider: 'google' },
      { id: teacherB1.id, email: teacherB1.email, authMode: 'google', authProvider: 'google' },
    ]);
    await ownerDb
      .insert(schools)
      .values([
        fixtureSchool(schoolAId, adminA.id, 'School A'),
        fixtureSchool(schoolBId, adminB.id, 'School B'),
      ]);
    await ownerDb
      .insert(schoolMembers)
      .values([
        fixtureMember(memberA1Id, schoolAId, teacherA1.id, teacherA1.email),
        fixtureMember(memberB1Id, schoolBId, teacherB1.id, teacherB1.email),
      ]);
  });

  afterAll(async () => {
    await ownerClient`DELETE FROM school_members WHERE school_id IN (${schoolAId}, ${schoolBId})`;
    await ownerClient`DELETE FROM schools WHERE id IN (${schoolAId}, ${schoolBId})`;
    await ownerClient`DELETE FROM users WHERE id IN (${adminA.id}, ${adminB.id}, ${teacherA1.id}, ${teacherA2.id}, ${teacherB1.id})`;
    await ownerClient.end();
    await appClient.end();
  });

  it('lets the admin read every member of their own school', async () => {
    const rows = await withTenantContext(appDb, adminA.id, (tx) =>
      tx.select().from(schoolMembers).where(eq(schoolMembers.schoolId, schoolAId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(teacherA1.id);
  });

  it("blocks a different admin from reading another school's members", async () => {
    const rows = await withTenantContext(appDb, adminB.id, (tx) =>
      tx.select().from(schoolMembers).where(eq(schoolMembers.schoolId, schoolAId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('lets the admin add a new member to their own school', async () => {
    const newId = randomUUID();
    await withTenantContext(appDb, adminA.id, (tx) =>
      tx
        .insert(schoolMembers)
        .values(fixtureMember(newId, schoolAId, teacherA2.id, teacherA2.email)),
    );
    const rows = await ownerClient`SELECT 1 FROM school_members WHERE id = ${newId}`;
    expect(rows).toHaveLength(1);
    await ownerClient`DELETE FROM school_members WHERE id = ${newId}`;
  });

  it("blocks a different admin from adding a member to a school they don't own", async () => {
    const attemptedId = randomUUID();
    await expect(
      withTenantContext(appDb, adminB.id, (tx) =>
        tx
          .insert(schoolMembers)
          .values(fixtureMember(attemptedId, schoolAId, teacherA2.id, teacherA2.email)),
      ),
    ).rejects.toThrow();

    const rows = await ownerClient`SELECT 1 FROM school_members WHERE id = ${attemptedId}`;
    expect(rows).toHaveLength(0);
  });

  it('lets the admin remove a member from their own school', async () => {
    const newId = randomUUID();
    const ownerDb = drizzle(ownerClient, { schema: { schoolMembers } });
    await ownerDb
      .insert(schoolMembers)
      .values(fixtureMember(newId, schoolBId, teacherA2.id, teacherA2.email));
    await withTenantContext(appDb, adminB.id, (tx) =>
      tx.delete(schoolMembers).where(eq(schoolMembers.id, newId)),
    );
    const rows = await ownerClient`SELECT 1 FROM school_members WHERE id = ${newId}`;
    expect(rows).toHaveLength(0);
  });

  it('lets a teacher read their own membership row, including the denormalized Drive location', async () => {
    const rows = await withTenantContext(appDb, teacherA1.id, (tx) =>
      tx.select().from(schoolMembers).where(eq(schoolMembers.id, memberA1Id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.driveAccessGranted).toBe(false);
    expect(rows[0]?.driveLocationType).toBe('folder');
    expect(rows[0]?.driveLocationId).toBe(`fixture-drive-folder-${schoolAId}`);
  });

  it("blocks a teacher from reading another teacher's membership row, even in the same school", async () => {
    const rows = await withTenantContext(appDb, teacherA1.id, (tx) =>
      tx.select().from(schoolMembers).where(eq(schoolMembers.id, memberB1Id)),
    );
    expect(rows).toHaveLength(0);
  });

  it("lets a teacher update their own row's driveAccessGranted flag", async () => {
    await withTenantContext(appDb, teacherA1.id, (tx) =>
      tx
        .update(schoolMembers)
        .set({ driveAccessGranted: true })
        .where(eq(schoolMembers.id, memberA1Id)),
    );
    const rows =
      await ownerClient`SELECT drive_access_granted FROM school_members WHERE id = ${memberA1Id}`;
    expect(rows[0]?.drive_access_granted).toBe(true);

    await ownerClient`UPDATE school_members SET drive_access_granted = false WHERE id = ${memberA1Id}`;
  });

  it("blocks a teacher from updating another teacher's row", async () => {
    await withTenantContext(appDb, teacherA1.id, (tx) =>
      tx
        .update(schoolMembers)
        .set({ driveAccessGranted: true })
        .where(eq(schoolMembers.id, memberB1Id)),
    );
    const rows =
      await ownerClient`SELECT drive_access_granted FROM school_members WHERE id = ${memberB1Id}`;
    expect(rows[0]?.drive_access_granted).toBe(false);
  });

  it('blocks a teacher from inserting their own membership row (admin-only action)', async () => {
    const attemptedId = randomUUID();
    await expect(
      withTenantContext(appDb, teacherA2.id, (tx) =>
        tx
          .insert(schoolMembers)
          .values(fixtureMember(attemptedId, schoolAId, teacherA2.id, teacherA2.email)),
      ),
    ).rejects.toThrow();

    const rows = await ownerClient`SELECT 1 FROM school_members WHERE id = ${attemptedId}`;
    expect(rows).toHaveLength(0);
  });

  it('blocks a teacher from deleting their own membership row (admin-only action)', async () => {
    await withTenantContext(appDb, teacherA1.id, (tx) =>
      tx.delete(schoolMembers).where(eq(schoolMembers.id, memberA1Id)),
    );
    const rows = await ownerClient`SELECT 1 FROM school_members WHERE id = ${memberA1Id}`;
    expect(rows).toHaveLength(1);
  });

  it("confirms schools itself still has no teacher-facing policy (a teacher can't read schools directly)", async () => {
    const rows = await withTenantContext(appDb, teacherA1.id, (tx) =>
      tx.select().from(schools).where(eq(schools.id, schoolAId)),
    );
    expect(rows).toHaveLength(0);
  });
});

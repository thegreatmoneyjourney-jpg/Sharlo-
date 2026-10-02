import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { users } from '../src/db/schema.js';
import { createSession } from '../src/auth/session.js';

const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const APP_DB_ROLE_PASSWORD = process.env.APP_DB_ROLE_PASSWORD ?? 'app_user_dev_password';

/**
 * `M3-015`/`FR-SCHOOL-02` — the add-teacher and membership routes.
 * `addTeacherToSchool`'s own two found-and-documented preconditions
 * (teacher must have a real Google-authenticated account; can only ever
 * be added once, ever) each get their own route-level test here, not just
 * unit coverage in `school-members.ts` directly, since the route's status
 * code is part of this task's own contract.
 */
describe.skipIf(!DATABASE_URL || !APP_DATABASE_URL)('school member routes', () => {
  const ownerClient = postgres(DATABASE_URL!, { max: 1 });
  const appClient = postgres(APP_DATABASE_URL!, { max: 5 });
  const appDb = drizzle(appClient, { schema });

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    await runMigrations(DATABASE_URL!, APP_DB_ROLE_PASSWORD);
  });

  afterAll(async () => {
    await ownerClient.end();
    await appClient.end();
  });

  async function createGoogleUser() {
    const user = { id: randomUUID(), email: `smr-${randomUUID()}@example.com` };
    const ownerDb = drizzle(ownerClient, { schema: { users } });
    await ownerDb
      .insert(users)
      .values({ id: user.id, email: user.email, authMode: 'google', authProvider: 'google' });
    return user;
  }

  async function createLocalOnlyUser() {
    const user = { id: randomUUID(), email: `smr-local-${randomUUID()}@example.com` };
    const ownerDb = drizzle(ownerClient, { schema: { users } });
    await ownerDb.insert(users).values({
      id: user.id,
      email: user.email,
      authMode: 'local_only',
      authProvider: 'email_otp',
    });
    return user;
  }

  async function cleanupUser(userId: string) {
    // Deletes member rows for schools this user *admins* first — a
    // teacher's own membership row has `user_id` set to the *teacher*, not
    // the admin, so cleaning up only `WHERE user_id = userId` misses it and
    // leaves a row that still references the about-to-be-deleted school,
    // tripping `school_members_school_id_schools_id_fk` (found by actually
    // hitting this FK violation, not assumed).
    await ownerClient`DELETE FROM school_members WHERE school_id IN (SELECT id FROM schools WHERE admin_user_id = ${userId})`;
    await ownerClient`DELETE FROM school_members WHERE user_id = ${userId}`;
    await ownerClient`DELETE FROM schools WHERE admin_user_id = ${userId}`;
    await ownerClient`DELETE FROM sessions WHERE user_id = ${userId}`;
    await ownerClient`DELETE FROM users WHERE id = ${userId}`;
  }

  async function buildTestApp() {
    const app = buildApp({
      db: appDb,
      apiBaseUrl: 'https://api.example.com',
      appBaseUrl: 'https://app.example.com',
      useSecureCookies: true,
      cookieSigningSecret: 'test-cookie-signing-secret-value',
    });
    await app.ready();
    return app;
  }

  async function createSchoolFor(
    app: ReturnType<typeof buildApp>,
    adminSession: { token: string; csrfToken: string },
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/schools',
      cookies: { sharlo_session: app.signCookie(adminSession.token) },
      headers: { 'x-csrf-token': adminSession.csrfToken },
      payload: {
        name: 'Riverside Academy',
        driveLocationType: 'folder',
        driveLocationId: 'fixture-drive-folder-id',
        schoolWrappedKeyByAdminMasterKey: 'aabbcc',
        adminX25519PublicKey: 'ddeeff',
        adminX25519WrappedPrivateKey: '001122',
      },
    });
    return response.json().id as string;
  }

  it('rejects POST /schools/:id/members with no session', async () => {
    const app = await buildTestApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/schools/${randomUUID()}/members`,
        payload: { email: 'teacher@example.com' },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects a request missing the CSRF header', async () => {
    const app = await buildTestApp();
    const admin = await createGoogleUser();
    try {
      const session = await createSession(appDb, admin.id);
      const response = await app.inject({
        method: 'POST',
        url: `/schools/${randomUUID()}/members`,
        cookies: { sharlo_session: app.signCookie(session.token) },
        payload: { email: 'teacher@example.com' },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
      await cleanupUser(admin.id);
    }
  });

  it('rejects an invalid email', async () => {
    const app = await buildTestApp();
    const admin = await createGoogleUser();
    try {
      const session = await createSession(appDb, admin.id);
      const schoolId = await createSchoolFor(app, session);
      const response = await app.inject({
        method: 'POST',
        url: `/schools/${schoolId}/members`,
        cookies: { sharlo_session: app.signCookie(session.token) },
        headers: { 'x-csrf-token': session.csrfToken },
        payload: { email: 'not-an-email' },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
      await cleanupUser(admin.id);
    }
  });

  it('returns 404 teacher_not_found when no account exists for that email', async () => {
    const app = await buildTestApp();
    const admin = await createGoogleUser();
    try {
      const session = await createSession(appDb, admin.id);
      const schoolId = await createSchoolFor(app, session);
      const response = await app.inject({
        method: 'POST',
        url: `/schools/${schoolId}/members`,
        cookies: { sharlo_session: app.signCookie(session.token) },
        headers: { 'x-csrf-token': session.csrfToken },
        payload: { email: `nobody-${randomUUID()}@example.com` },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'teacher_not_found' });
    } finally {
      await app.close();
      await cleanupUser(admin.id);
    }
  });

  it('returns 409 wrong_auth_provider for a local-only/email-OTP account', async () => {
    const app = await buildTestApp();
    const admin = await createGoogleUser();
    const localTeacher = await createLocalOnlyUser();
    try {
      const session = await createSession(appDb, admin.id);
      const schoolId = await createSchoolFor(app, session);
      const response = await app.inject({
        method: 'POST',
        url: `/schools/${schoolId}/members`,
        cookies: { sharlo_session: app.signCookie(session.token) },
        headers: { 'x-csrf-token': session.csrfToken },
        payload: { email: localTeacher.email },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: 'wrong_auth_provider' });
    } finally {
      await app.close();
      await cleanupUser(admin.id);
      await cleanupUser(localTeacher.id);
    }
  });

  it('returns 404 school_not_found for a school the caller does not admin', async () => {
    const app = await buildTestApp();
    const adminA = await createGoogleUser();
    const adminB = await createGoogleUser();
    const teacher = await createGoogleUser();
    try {
      const sessionA = await createSession(appDb, adminA.id);
      const sessionB = await createSession(appDb, adminB.id);
      const schoolAId = await createSchoolFor(app, sessionA);

      const response = await app.inject({
        method: 'POST',
        url: `/schools/${schoolAId}/members`,
        cookies: { sharlo_session: app.signCookie(sessionB.token) },
        headers: { 'x-csrf-token': sessionB.csrfToken },
        payload: { email: teacher.email },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'school_not_found' });
    } finally {
      await app.close();
      await cleanupUser(adminA.id);
      await cleanupUser(adminB.id);
      await cleanupUser(teacher.id);
    }
  });

  it('adds a teacher, lists them back, and lets the teacher read their own pending membership', async () => {
    const app = await buildTestApp();
    const admin = await createGoogleUser();
    const teacher = await createGoogleUser();
    try {
      const adminSession = await createSession(appDb, admin.id);
      const schoolId = await createSchoolFor(app, adminSession);

      const addResponse = await app.inject({
        method: 'POST',
        url: `/schools/${schoolId}/members`,
        cookies: { sharlo_session: app.signCookie(adminSession.token) },
        headers: { 'x-csrf-token': adminSession.csrfToken },
        payload: { email: teacher.email },
      });
      expect(addResponse.statusCode).toBe(201);
      expect(addResponse.json()).toMatchObject({
        userId: teacher.id,
        email: teacher.email,
        driveAccessGranted: false,
      });

      const listResponse = await app.inject({
        method: 'GET',
        url: `/schools/${schoolId}/members`,
        cookies: { sharlo_session: app.signCookie(adminSession.token) },
      });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json().members).toHaveLength(1);
      expect(listResponse.json().members[0]).toMatchObject({ email: teacher.email });

      const teacherSession = await createSession(appDb, teacher.id);
      const membershipResponse = await app.inject({
        method: 'GET',
        url: '/schools/my-membership',
        cookies: { sharlo_session: app.signCookie(teacherSession.token) },
      });
      expect(membershipResponse.statusCode).toBe(200);
      expect(membershipResponse.json().membership).toMatchObject({
        schoolId,
        driveLocationType: 'folder',
        driveLocationId: 'fixture-drive-folder-id',
        driveAccessGranted: false,
      });

      const confirmResponse = await app.inject({
        method: 'POST',
        url: '/schools/my-membership/confirm-drive-access',
        cookies: { sharlo_session: app.signCookie(teacherSession.token) },
        headers: { 'x-csrf-token': teacherSession.csrfToken },
      });
      expect(confirmResponse.statusCode).toBe(204);

      const afterConfirm = await app.inject({
        method: 'GET',
        url: '/schools/my-membership',
        cookies: { sharlo_session: app.signCookie(teacherSession.token) },
      });
      expect(afterConfirm.json().membership.driveAccessGranted).toBe(true);
    } finally {
      await app.close();
      await cleanupUser(admin.id);
      await cleanupUser(teacher.id);
    }
  });

  it('returns 409 already_member when adding the same teacher twice', async () => {
    const app = await buildTestApp();
    const admin = await createGoogleUser();
    const teacher = await createGoogleUser();
    try {
      const session = await createSession(appDb, admin.id);
      const schoolId = await createSchoolFor(app, session);

      await app.inject({
        method: 'POST',
        url: `/schools/${schoolId}/members`,
        cookies: { sharlo_session: app.signCookie(session.token) },
        headers: { 'x-csrf-token': session.csrfToken },
        payload: { email: teacher.email },
      });

      const secondAttempt = await app.inject({
        method: 'POST',
        url: `/schools/${schoolId}/members`,
        cookies: { sharlo_session: app.signCookie(session.token) },
        headers: { 'x-csrf-token': session.csrfToken },
        payload: { email: teacher.email },
      });
      expect(secondAttempt.statusCode).toBe(409);
      expect(secondAttempt.json()).toEqual({ error: 'already_member' });
    } finally {
      await app.close();
      await cleanupUser(admin.id);
      await cleanupUser(teacher.id);
    }
  });

  it('returns {membership: null} for a teacher with no school', async () => {
    const app = await buildTestApp();
    const teacher = await createGoogleUser();
    try {
      const session = await createSession(appDb, teacher.id);
      const response = await app.inject({
        method: 'GET',
        url: '/schools/my-membership',
        cookies: { sharlo_session: app.signCookie(session.token) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ membership: null });
    } finally {
      await app.close();
      await cleanupUser(teacher.id);
    }
  });
});

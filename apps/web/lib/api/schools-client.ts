/**
 * `M3-014` — thin fetch wrappers around `apps/api/src/routes/schools.ts`,
 * matching `account-encryption-client.ts`'s established shape (framework
 * -agnostic, `credentials: 'include'`, CSRF header echoed from the
 * double-submit cookie).
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const CSRF_COOKIE_NAME = 'sharlo_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

function readCsrfCookie(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

export type DriveLocationType = 'shared_drive' | 'folder';

export interface SchoolSummary {
  id: string;
  name: string;
  driveLocationType: DriveLocationType;
  driveLocationId: string;
}

export async function fetchMySchools(): Promise<SchoolSummary[]> {
  const response = await fetch(`${API_BASE_URL}/schools`, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to fetch schools (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { schools: SchoolSummary[] };
  return body.schools;
}

export interface CreateSchoolPayload {
  name: string;
  driveLocationType: DriveLocationType;
  driveLocationId: string;
  schoolWrappedKeyByAdminMasterKey: string;
  adminX25519PublicKey: string;
  adminX25519WrappedPrivateKey: string;
}

export async function submitCreateSchool(payload: CreateSchoolPayload): Promise<SchoolSummary> {
  const response = await fetch(`${API_BASE_URL}/schools`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', [CSRF_HEADER_NAME]: readCsrfCookie() },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to create school (HTTP ${response.status})`);
  }
  return response.json();
}

export interface SchoolMemberSummary {
  id: string;
  userId: string;
  email: string;
  driveAccessGranted: boolean;
}

export async function fetchSchoolMembers(schoolId: string): Promise<SchoolMemberSummary[]> {
  const response = await fetch(`${API_BASE_URL}/schools/${schoolId}/members`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch school members (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { members: SchoolMemberSummary[] };
  return body.members;
}

/**
 * `M3-015` — mirrors `apps/api/src/auth/school-members.ts`'s own
 * `AddTeacherResult` outcomes exactly, so the UI can show a specific,
 * correct message per case rather than one generic "something went
 * wrong." `added` is the only outcome with an HTTP 2xx status; the other
 * four are each a specific, expected 404/409, not a thrown error.
 */
export type AddTeacherOutcome =
  | { outcome: 'added'; member: SchoolMemberSummary }
  | { outcome: 'teacher_not_found' }
  | { outcome: 'wrong_auth_provider' }
  | { outcome: 'already_member' }
  | { outcome: 'school_not_found' };

const ADD_TEACHER_ERROR_OUTCOMES = [
  'teacher_not_found',
  'wrong_auth_provider',
  'already_member',
  'school_not_found',
] as const;

export async function submitAddTeacher(
  schoolId: string,
  email: string,
): Promise<AddTeacherOutcome> {
  const response = await fetch(`${API_BASE_URL}/schools/${schoolId}/members`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', [CSRF_HEADER_NAME]: readCsrfCookie() },
    body: JSON.stringify({ email }),
  });
  if (response.status === 201) {
    const member = (await response.json()) as SchoolMemberSummary;
    return { outcome: 'added', member };
  }
  if (response.status === 404 || response.status === 409) {
    const body = (await response.json()) as { error: string };
    const match = ADD_TEACHER_ERROR_OUTCOMES.find((outcome) => outcome === body.error);
    if (match) {
      return { outcome: match };
    }
  }
  throw new Error(`Failed to add teacher (HTTP ${response.status})`);
}

export interface MyMembership {
  id: string;
  schoolId: string;
  driveLocationType: DriveLocationType;
  driveLocationId: string;
  driveAccessGranted: boolean;
}

export async function fetchMyMembership(): Promise<MyMembership | null> {
  const response = await fetch(`${API_BASE_URL}/schools/my-membership`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch school membership (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { membership: MyMembership | null };
  return body.membership;
}

export async function submitConfirmDriveAccess(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/schools/my-membership/confirm-drive-access`, {
    method: 'POST',
    credentials: 'include',
    headers: { [CSRF_HEADER_NAME]: readCsrfCookie() },
  });
  if (!response.ok) {
    throw new Error(`Failed to confirm Drive access (HTTP ${response.status})`);
  }
}

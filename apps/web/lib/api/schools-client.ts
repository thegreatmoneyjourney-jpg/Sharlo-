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

/**
 * Thin fetch wrapper around `apps/api/src/routes/account.ts`, matching
 * `account-encryption-client.ts`'s existing split (`lib/` = plain
 * TypeScript, `app/` = UI). Read-only GET, no CSRF header needed.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export interface AccountInfoResponse {
  authMode: 'google' | 'local_only';
}

export async function fetchAccountInfo(): Promise<AccountInfoResponse> {
  const response = await fetch(`${API_BASE_URL}/account/me`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch account info (HTTP ${response.status})`);
  }
  return response.json();
}

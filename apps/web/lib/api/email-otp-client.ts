/**
 * Thin fetch wrapper around `apps/api/src/routes/email-otp.ts`, matching
 * `account-encryption-client.ts`'s existing split. `requestOtp` never
 * throws on a "the email might not have an account" basis — the API
 * itself returns the identical response either way (no enumeration
 * signal), so this client has nothing to distinguish. `verifyOtp`
 * returns a discriminated result rather than throwing on an expected
 * "wrong code" outcome — that's a normal, expected user-facing state for
 * a sign-in form, not an exceptional one; it still throws on a genuinely
 * unexpected response (e.g. a 500, or the request being malformed).
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export async function requestEmailOtp(email: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/email-otp/request`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(`Failed to request a sign-in code (HTTP ${response.status})`);
  }
}

export type VerifyEmailOtpOutcome =
  'success' | 'invalid_code' | 'expired' | 'too_many_attempts' | 'wrong_provider' | 'invalid_body';

export async function verifyEmailOtp(email: string, code: string): Promise<VerifyEmailOtpOutcome> {
  const response = await fetch(`${API_BASE_URL}/auth/email-otp/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (response.ok) {
    return 'success';
  }
  if (response.status === 400) {
    const body = (await response.json()) as { error: VerifyEmailOtpOutcome };
    return body.error;
  }
  throw new Error(`Failed to verify sign-in code (HTTP ${response.status})`);
}

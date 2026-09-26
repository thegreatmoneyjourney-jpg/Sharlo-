import type { Argon2idParams } from '../crypto/argon2id';

/**
 * Thin fetch wrappers around `apps/api/src/routes/encryption.ts` — kept
 * framework-agnostic (no React) and separate from the settings page's own
 * component code, matching this codebase's existing split between
 * `lib/` (plain TypeScript, independently unit-testable) and `app/`
 * (UI). `credentials: 'include'` is required on every call: the web app
 * and API are separate origins (`ARCHITECTURE.md` §12), and the session
 * cookie is set on the API's own origin.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const CSRF_COOKIE_NAME = 'sharlo_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * The CSRF cookie is deliberately NOT httpOnly (`ARCHITECTURE.md` §9's
 * double-submit design) specifically so client-side JS can read it back
 * and echo it as a header — this is that read, not a workaround.
 */
function readCsrfCookie(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

export interface EncryptionParamsResponse {
  hasEncryptionSetup: boolean;
  wrappedMasterKeyByPassphrase?: string;
  wrappedMasterKeyByRecovery?: string;
  kdfSalt?: string;
  kdfParams?: Argon2idParams;
  recoveryKeyVerifier?: string;
}

export async function fetchEncryptionParams(): Promise<EncryptionParamsResponse> {
  const response = await fetch(`${API_BASE_URL}/account/encryption-params`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch encryption params (HTTP ${response.status})`);
  }
  return response.json();
}

export interface EncryptionSetupPayload {
  wrappedMasterKeyByPassphrase: string;
  wrappedMasterKeyByRecovery: string;
  kdfSalt: string;
  kdfParams: Argon2idParams;
  recoveryKeyVerifier: string;
}

export async function submitEncryptionSetup(payload: EncryptionSetupPayload): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/account/encryption-setup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', [CSRF_HEADER_NAME]: readCsrfCookie() },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to save encryption setup (HTTP ${response.status})`);
  }
}

export interface PassphraseChangePayload {
  wrappedMasterKeyByPassphrase: string;
  kdfSalt: string;
  kdfParams: Argon2idParams;
}

export async function submitPassphraseChange(payload: PassphraseChangePayload): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/account/encryption-passphrase`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', [CSRF_HEADER_NAME]: readCsrfCookie() },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to save new passphrase (HTTP ${response.status})`);
  }
}

export interface RecoveryKeyReminderStatusResponse {
  showBanner: boolean;
}

/** M3-004/FR-AUTH-09 — polled by the app-wide banner, not just the settings page. */
export async function fetchRecoveryKeyReminderStatus(): Promise<RecoveryKeyReminderStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/account/recovery-key-reminder-status`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch recovery key reminder status (HTTP ${response.status})`);
  }
  return response.json();
}

export interface RecoveryKeyReminderConfirmPayload {
  wrappedMasterKeyByRecovery: string;
  recoveryKeyVerifier: string;
}

export async function submitRecoveryKeyReminderConfirm(
  payload: RecoveryKeyReminderConfirmPayload,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/account/recovery-key-reminder-confirm`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', [CSRF_HEADER_NAME]: readCsrfCookie() },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to confirm Recovery Key (HTTP ${response.status})`);
  }
}

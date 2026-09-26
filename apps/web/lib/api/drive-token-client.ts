/**
 * `M3-006` — thin client for `POST /account/drive-access-token`, plus an
 * in-memory-only cache. Never written to any persistent storage
 * (localStorage/IndexedDB/cookies) — a live Drive access token is a real
 * credential, and this module's whole job is to keep it as short-lived
 * and narrowly-held as the architecture already requires (`ADR-0004`).
 * Module-level state is fine here specifically because it's disposable:
 * losing it on a page reload just means the next call mints a new one.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const CSRF_COOKIE_NAME = 'sharlo_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
// Refresh this long before Google's own expiry to absorb request latency
// and clock skew — an access token that expires mid-request is worse
// than minting a few seconds early.
const REFRESH_MARGIN_MS = 60_000;

function readCsrfCookie(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

async function mintToken(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/account/drive-access-token`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', [CSRF_HEADER_NAME]: readCsrfCookie() },
  });
  if (!response.ok) {
    throw new Error(`Failed to obtain a Drive access token (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { accessToken: string; expiresInSeconds: number };
  cached = { accessToken: body.accessToken, expiresAt: Date.now() + body.expiresInSeconds * 1000 };
  return cached.accessToken;
}

/**
 * Returns a currently-valid Drive access token, minting a fresh one only
 * when the cached one is missing or close to expiry. Concurrent callers
 * during an in-progress mint share the same request rather than each
 * triggering their own — plausible here, since more than one envelope
 * write can legitimately happen close together.
 */
export async function getDriveAccessToken(): Promise<string> {
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cached.accessToken;
  }
  if (!inFlight) {
    inFlight = mintToken().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Test-only: clears the module-level cache so each test starts clean. */
export function _resetDriveAccessTokenCacheForTests(): void {
  cached = null;
  inFlight = null;
}

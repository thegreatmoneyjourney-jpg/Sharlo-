import { getDriveAccessToken } from '../api/drive-token-client';

/**
 * `M3-014` — extracted from `storage/drive-envelope-store.ts` (`M3-006`)
 * the moment a second real call site needed the identical "authenticated
 * fetch straight to Google's own API, zero backend involvement" pattern
 * (`ADR-0004`): creating the School-plan's Drive container
 * (`school-drive-container.ts`). `drive-envelope-store.ts` now imports
 * this instead of keeping its own copy — same test seam shape
 * (`_configureDriveFetchForTests`/`_resetDriveFetchForTests`), so nothing
 * about how that file is tested needed to change.
 */

let fetchImpl: typeof fetch = fetch;
let getAccessToken: () => Promise<string> = getDriveAccessToken;

/** Test-only: injects a fake `fetch` and/or access-token provider. Only overrides whatever field is actually passed. */
export function _configureDriveFetchForTests(deps: {
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string>;
}): void {
  if (deps.fetchImpl) {
    fetchImpl = deps.fetchImpl;
  }
  if (deps.getAccessToken) {
    getAccessToken = deps.getAccessToken;
  }
}

/** Test-only: restores both to their real implementations. */
export function _resetDriveFetchForTests(): void {
  fetchImpl = fetch;
  getAccessToken = getDriveAccessToken;
}

export async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = await getAccessToken();
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Drive API request failed: ${response.status} ${await response.text()}`);
  }
  return response;
}

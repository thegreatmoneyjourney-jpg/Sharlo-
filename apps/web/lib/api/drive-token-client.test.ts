import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetDriveAccessTokenCacheForTests, getDriveAccessToken } from './drive-token-client';

function mockTokenResponse(accessToken: string, expiresInSeconds: number) {
  return { ok: true, json: async () => ({ accessToken, expiresInSeconds }) };
}

beforeEach(() => {
  _resetDriveAccessTokenCacheForTests();
  document.cookie = 'sharlo_csrf=test-csrf-token-value';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.cookie = 'sharlo_csrf=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
});

describe('getDriveAccessToken', () => {
  it('mints a token, sending credentials and the CSRF header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockTokenResponse('token-1', 3600));
    vi.stubGlobal('fetch', fetchMock);

    const token = await getDriveAccessToken();

    expect(token).toBe('token-1');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/account\/drive-access-token$/);
    expect(options.method).toBe('POST');
    expect(options.credentials).toBe('include');
    expect(options.headers['x-csrf-token']).toBe('test-csrf-token-value');
  });

  it('reuses the cached token without re-minting while it is still comfortably valid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockTokenResponse('token-1', 3600));
    vi.stubGlobal('fetch', fetchMock);

    await getDriveAccessToken();
    await getDriveAccessToken();
    await getDriveAccessToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mints a new token once the cached one is within the refresh margin of expiring', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse('token-1', 120))
      .mockResolvedValueOnce(mockTokenResponse('token-2', 3600));
    vi.stubGlobal('fetch', fetchMock);

    const first = await getDriveAccessToken();
    vi.advanceTimersByTime(90_000); // past (120s - 60s margin), before the full 120s
    const second = await getDriveAccessToken();

    expect(first).toBe('token-1');
    expect(second).toBe('token-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight mint across concurrent callers rather than firing one each', async () => {
    let resolveResponse!: (value: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = getDriveAccessToken();
    const second = getDriveAccessToken();
    resolveResponse(mockTokenResponse('token-1', 3600));

    expect(await first).toBe('token-1');
    expect(await second).toBe('token-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }));
    await expect(getDriveAccessToken()).rejects.toThrow(/409/);
  });
});

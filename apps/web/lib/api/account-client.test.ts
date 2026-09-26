import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAccountInfo } from './account-client';

describe('account-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchAccountInfo sends credentials and returns the parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authMode: 'local_only' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAccountInfo();

    expect(result).toEqual({ authMode: 'local_only' });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.credentials).toBe('include');
  });

  it('fetchAccountInfo throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(fetchAccountInfo()).rejects.toThrow(/401/);
  });
});

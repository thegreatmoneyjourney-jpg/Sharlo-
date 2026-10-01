import { afterEach, describe, expect, it, vi } from 'vitest';
import { _configureDriveFetchForTests, _resetDriveFetchForTests, driveFetch } from './drive-fetch';

afterEach(() => {
  _resetDriveFetchForTests();
});

describe('driveFetch', () => {
  it('attaches a Bearer Authorization header from the configured access-token provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token-123' });

    await driveFetch('https://example.com/x');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/x',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });

  it('preserves caller-supplied headers alongside the Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token-123' });

    await driveFetch('https://example.com/x', { headers: { 'Content-Type': 'application/json' } });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/x',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' },
      }),
    );
  });

  it('throws with the status code and body text when the response is not ok', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, text: async () => 'insufficient scope' });
    _configureDriveFetchForTests({ fetchImpl: fetchMock, getAccessToken: async () => 'token-123' });

    await expect(driveFetch('https://example.com/x')).rejects.toThrow(/403.*insufficient scope/);
  });
});

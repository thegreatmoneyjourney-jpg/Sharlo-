import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestEmailOtp, verifyEmailOtp } from './email-otp-client';

describe('email-otp-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('requestEmailOtp', () => {
    it('posts the email and includes credentials', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      await requestEmailOtp('teacher@example.com');

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/auth\/email-otp\/request$/);
      expect(options.method).toBe('POST');
      expect(options.credentials).toBe('include');
      expect(JSON.parse(options.body)).toEqual({ email: 'teacher@example.com' });
    });

    it('throws on a non-OK response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
      await expect(requestEmailOtp('teacher@example.com')).rejects.toThrow(/429/);
    });
  });

  describe('verifyEmailOtp', () => {
    it('returns "success" on a 200 response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
      const result = await verifyEmailOtp('teacher@example.com', '123456');
      expect(result).toBe('success');
    });

    it('returns the specific outcome from a 400 response body, without throwing', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => ({ error: 'invalid_code' }),
        }),
      );
      const result = await verifyEmailOtp('teacher@example.com', '000000');
      expect(result).toBe('invalid_code');
    });

    it('throws on an unexpected non-400 error response (e.g. rate limited)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
      await expect(verifyEmailOtp('teacher@example.com', '123456')).rejects.toThrow(/429/);
    });
  });
});

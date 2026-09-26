import { describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_OAUTH_SCOPE,
  buildGoogleAuthorizationUrl,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
} from '../src/auth/google-oauth.js';

describe('buildGoogleAuthorizationUrl', () => {
  it('requests exactly the openid/email/profile/drive.file scope, nothing broader', () => {
    expect(GOOGLE_OAUTH_SCOPE).toBe(
      'openid email profile https://www.googleapis.com/auth/drive.file',
    );
  });

  it('builds a URL to the real Google authorization endpoint with every required param', () => {
    const url = new URL(
      buildGoogleAuthorizationUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://api.example.com/auth/google/callback',
        state: 'test-state-value',
        codeChallenge: 'test-challenge-value',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/auth/google/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(GOOGLE_OAUTH_SCOPE);
    expect(url.searchParams.get('state')).toBe('test-state-value');
    expect(url.searchParams.get('code_challenge')).toBe('test-challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });
});

describe('exchangeCodeForTokens', () => {
  it('POSTs the PKCE verifier and auth-code params to the token endpoint, and returns the parsed response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'placeholder-access-token',
          refresh_token: 'placeholder-refresh-token',
          expires_in: 3600,
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
          token_type: 'Bearer',
        }),
    });

    const result = await exchangeCodeForTokens(
      {
        clientId: 'test-client-id',
        clientSecret: 'placeholder-client-secret',
        redirectUri: 'https://api.example.com/auth/google/callback',
        code: 'placeholder-auth-code',
        codeVerifier: 'placeholder-code-verifier',
      },
      mockFetch as unknown as typeof fetch,
    );

    expect(result.access_token).toBe('placeholder-access-token');
    expect(result.refresh_token).toBe('placeholder-refresh-token');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('client_id')).toBe('test-client-id');
    expect(body.get('client_secret')).toBe('placeholder-client-secret');
    expect(body.get('code')).toBe('placeholder-auth-code');
    expect(body.get('code_verifier')).toBe('placeholder-code-verifier');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('throws with the response body when Google rejects the exchange', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"invalid_grant"}'),
    });

    await expect(
      exchangeCodeForTokens(
        {
          clientId: 'x',
          clientSecret: 'x',
          redirectUri: 'https://api.example.com/auth/google/callback',
          code: 'x',
          codeVerifier: 'x',
        },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/invalid_grant/);
  });
});

describe('fetchGoogleUserInfo', () => {
  it('sends the access token as a Bearer header and returns the parsed profile', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          sub: 'google-subject-id-123',
          email: 'teacher@example.com',
          email_verified: true,
          name: 'Test Teacher',
        }),
    });

    const result = await fetchGoogleUserInfo(
      'placeholder-access-token',
      mockFetch as unknown as typeof fetch,
    );

    expect(result.sub).toBe('google-subject-id-123');
    expect(result.email).toBe('teacher@example.com');
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer placeholder-access-token',
    );
  });

  it('throws when Google rejects the userinfo request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('invalid token'),
    });

    await expect(
      fetchGoogleUserInfo('bad-token', mockFetch as unknown as typeof fetch),
    ).rejects.toThrow(/invalid token/);
  });
});

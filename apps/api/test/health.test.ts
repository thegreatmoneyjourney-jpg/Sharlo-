import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createAppDb } from '../src/db/client.js';

describe('GET /health', () => {
  it('returns ok status without requiring auth or a DB connection', async () => {
    // `postgres` connects lazily on first query — constructing this client
    // never actually touches the network, which is the whole point of this
    // test (the health route itself must never require a DB round-trip).
    const app = buildApp({
      db: createAppDb('postgres://unused:unused@localhost:1/unused'),
      apiBaseUrl: 'https://api.example.com',
      appBaseUrl: 'https://app.example.com',
      useSecureCookies: true,
      cookieSigningSecret: 'test-cookie-signing-secret',
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'sharlo-api' });

    await app.close();
  });
});

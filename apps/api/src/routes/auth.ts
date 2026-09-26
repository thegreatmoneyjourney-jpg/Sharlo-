import type { FastifyInstance } from 'fastify';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../db/schema.js';
import { getCredential } from '../integrations/credential-store.js';
import { deriveCodeChallenge, generateCodeVerifier, generateState } from '../auth/pkce.js';
import {
  buildGoogleAuthorizationUrl,
  exchangeCodeForTokens as defaultExchangeCodeForTokens,
  fetchGoogleUserInfo as defaultFetchGoogleUserInfo,
} from '../auth/google-oauth.js';
import { findOrCreateUserByGoogleIdentity } from '../auth/user-account.js';
import { createSession } from '../auth/session.js';
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../auth/request-session.js';

type Db = PostgresJsDatabase<typeof schema>;

const OAUTH_STATE_COOKIE = 'sharlo_oauth_state';
const OAUTH_VERIFIER_COOKIE = 'sharlo_oauth_verifier';
const OAUTH_HANDSHAKE_MAX_AGE_SECONDS = 10 * 60; // the whole redirect dance normally takes seconds, not minutes
const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // matches session.ts's SESSION_DURATION_MS

export interface AuthRoutesOptions {
  db: Db;
  /** Origin the API itself is served from (used to build the Google `redirect_uri`) — e.g. `https://api.sharlo.app`. */
  apiBaseUrl: string;
  /** Origin the web app is served from — where the browser lands after a successful login. */
  appBaseUrl: string;
  /** `false` in local dev (plain HTTP); cookies marked `Secure` are silently dropped by the browser over HTTP. */
  useSecureCookies: boolean;
  /** Injectable seam for tests — real Google network calls by default. */
  googleOAuthClient?: {
    exchangeCodeForTokens: typeof defaultExchangeCodeForTokens;
    fetchGoogleUserInfo: typeof defaultFetchGoogleUserInfo;
  };
}

export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions): Promise<void> {
  const exchangeCodeForTokens =
    opts.googleOAuthClient?.exchangeCodeForTokens ?? defaultExchangeCodeForTokens;
  const fetchGoogleUserInfo =
    opts.googleOAuthClient?.fetchGoogleUserInfo ?? defaultFetchGoogleUserInfo;
  const redirectUri = `${opts.apiBaseUrl}/auth/google/callback`;

  const handshakeCookieOpts = {
    httpOnly: true,
    secure: opts.useSecureCookies,
    sameSite: 'lax' as const,
    signed: true,
    path: '/',
    maxAge: OAUTH_HANDSHAKE_MAX_AGE_SECONDS,
  };

  app.get('/auth/google/start', async (_req, reply) => {
    const clientId = await getCredential(opts.db, 'google_oauth', 'client_id');
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);

    reply
      .setCookie(OAUTH_STATE_COOKIE, state, handshakeCookieOpts)
      .setCookie(OAUTH_VERIFIER_COOKIE, codeVerifier, handshakeCookieOpts);

    return reply.redirect(
      buildGoogleAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }),
    );
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/google/callback',
    async (req, reply) => {
      if (req.query.error) {
        return reply.code(400).send({ error: 'oauth_denied' });
      }
      const { code, state } = req.query;
      if (!code || !state) {
        return reply.code(400).send({ error: 'missing_code_or_state' });
      }

      const stateCookie = req.cookies[OAUTH_STATE_COOKIE];
      const verifierCookie = req.cookies[OAUTH_VERIFIER_COOKIE];
      const unsignedState = stateCookie ? req.unsignCookie(stateCookie) : null;
      const unsignedVerifier = verifierCookie ? req.unsignCookie(verifierCookie) : null;

      reply
        .clearCookie(OAUTH_STATE_COOKIE, { path: '/' })
        .clearCookie(OAUTH_VERIFIER_COOKIE, { path: '/' });

      if (
        !unsignedState?.valid ||
        !unsignedVerifier?.valid ||
        !unsignedVerifier.value ||
        unsignedState.value !== state
      ) {
        return reply.code(400).send({ error: 'invalid_or_expired_oauth_state' });
      }

      const clientId = await getCredential(opts.db, 'google_oauth', 'client_id');
      const clientSecret = await getCredential(opts.db, 'google_oauth', 'client_secret');

      const tokens = await exchangeCodeForTokens({
        clientId,
        clientSecret,
        redirectUri,
        code,
        codeVerifier: unsignedVerifier.value,
      });
      const profile = await fetchGoogleUserInfo(tokens.access_token);

      const { id: userId } = await findOrCreateUserByGoogleIdentity(
        opts.db,
        { googleSub: profile.sub, email: profile.email },
        tokens.refresh_token,
      );

      const session = await createSession(opts.db, userId);

      reply
        // Signed (ARCHITECTURE.md §9's literal "signed, httpOnly" design):
        // the token itself is already unguessable (32 random bytes, looked
        // up in the DB), but signing catches a tampered/garbled cookie
        // value before spending a DB round-trip on it, and matches the
        // OAuth handshake cookies' own signed treatment above.
        .setCookie(SESSION_COOKIE_NAME, session.token, {
          httpOnly: true,
          secure: opts.useSecureCookies,
          sameSite: 'lax',
          signed: true,
          path: '/',
          maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
        })
        // Deliberately NOT httpOnly and NOT signed: the double-submit CSRF
        // pattern (ARCHITECTURE.md §9, ../auth/csrf-protection.ts) requires
        // client-side JS to read this value verbatim and echo it back as a
        // header — signing would change the string the client reads.
        .setCookie(CSRF_COOKIE_NAME, session.csrfToken, {
          httpOnly: false,
          secure: opts.useSecureCookies,
          sameSite: 'lax',
          path: '/',
          maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
        });

      return reply.redirect(opts.appBaseUrl);
    },
  );
}

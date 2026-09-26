import Fastify, { type FastifyInstance } from 'fastify';
import cookiePlugin from '@fastify/cookie';
import corsPlugin from '@fastify/cors';
import rateLimitPlugin from '@fastify/rate-limit';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './db/schema.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes, type AuthRoutesOptions } from './routes/auth.js';
import { encryptionRoutes } from './routes/encryption.js';
import { emailOtpRoutes } from './routes/email-otp.js';
import { registerCsrfProtection } from './auth/csrf-protection.js';
import type { EmailSender } from './email/email-sender.js';

export interface BuildAppOptions {
  db: PostgresJsDatabase<typeof schema>;
  apiBaseUrl: string;
  appBaseUrl: string;
  useSecureCookies: boolean;
  cookieSigningSecret: string;
  /** Optional so every pre-existing test that builds an app without caring about email-OTP routes keeps working unchanged. Omitting it is fine UNLESS a test actually exercises `/auth/email-otp/*` — then it should provide its own mock, and get a loud, clear failure here otherwise, not a silent false-pass. */
  emailSender?: EmailSender;
  googleOAuthClient?: AuthRoutesOptions['googleOAuthClient'];
}

const NO_EMAIL_SENDER_CONFIGURED: EmailSender = {
  send: async () => {
    throw new Error(
      'buildApp() was called without an emailSender, but something tried to send an email — pass a real (or test-mock) EmailSender via BuildAppOptions.',
    );
  },
};

/**
 * Builds the Fastify instance without starting it listening — kept separate
 * from index.ts so tests can build+inject against it without binding a port.
 */
export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: true,
  });

  app.register(cookiePlugin, { secret: opts.cookieSigningSecret });
  // credentials:true + an explicit single origin (never a wildcard,
  // NFR-SEC-17) — the web app and API are deliberately separate
  // origins/subdomains (ARCHITECTURE.md §12), and the session cookie is
  // set on the API's own origin, so a cross-origin fetch from the web
  // app needs CORS to both allow the origin and permit credentials.
  app.register(corsPlugin, { origin: opts.appBaseUrl, credentials: true });
  // `global: false` — this app's own routes opt in per-route (`app.rateLimit(...)`,
  // see `routes/email-otp.ts`) rather than every existing route
  // retroactively gaining a rate limit as a side effect of this task. A
  // blanket pass across every endpoint is real, separate M7 hardening
  // work, not something to fold in here silently.
  app.register(rateLimitPlugin, { global: false });

  registerCsrfProtection(app, opts.db);

  app.register(healthRoutes);
  app.register(authRoutes, {
    db: opts.db,
    apiBaseUrl: opts.apiBaseUrl,
    appBaseUrl: opts.appBaseUrl,
    useSecureCookies: opts.useSecureCookies,
    googleOAuthClient: opts.googleOAuthClient,
  });
  app.register(encryptionRoutes, { db: opts.db });
  app.register(emailOtpRoutes, {
    db: opts.db,
    emailSender: opts.emailSender ?? NO_EMAIL_SENDER_CONFIGURED,
    useSecureCookies: opts.useSecureCookies,
  });

  return app;
}

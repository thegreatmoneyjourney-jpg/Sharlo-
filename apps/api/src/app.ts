import Fastify, { type FastifyInstance } from 'fastify';
import cookiePlugin from '@fastify/cookie';
import corsPlugin from '@fastify/cors';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './db/schema.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes, type AuthRoutesOptions } from './routes/auth.js';
import { registerCsrfProtection } from './auth/csrf-protection.js';

export interface BuildAppOptions {
  db: PostgresJsDatabase<typeof schema>;
  apiBaseUrl: string;
  appBaseUrl: string;
  useSecureCookies: boolean;
  cookieSigningSecret: string;
  googleOAuthClient?: AuthRoutesOptions['googleOAuthClient'];
}

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

  registerCsrfProtection(app, opts.db);

  app.register(healthRoutes);
  app.register(authRoutes, {
    db: opts.db,
    apiBaseUrl: opts.apiBaseUrl,
    appBaseUrl: opts.appBaseUrl,
    useSecureCookies: opts.useSecureCookies,
    googleOAuthClient: opts.googleOAuthClient,
  });

  return app;
}

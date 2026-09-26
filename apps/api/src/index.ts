import { buildApp } from './app.js';
import { createAppDb } from './db/client.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to start the API server.`);
  }
  return value;
}

const app = buildApp({
  db: createAppDb(requireEnv('APP_DATABASE_URL')),
  apiBaseUrl: requireEnv('API_BASE_URL'),
  appBaseUrl: requireEnv('APP_BASE_URL'),
  useSecureCookies: process.env.NODE_ENV === 'production',
  cookieSigningSecret: requireEnv('COOKIE_SIGNING_SECRET'),
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

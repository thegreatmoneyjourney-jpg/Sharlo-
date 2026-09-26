import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { buildApp } from './app.js';
import { createAppDb } from './db/client.js';
import * as schema from './db/schema.js';
import { ResendEmailSender } from './email/resend-email-sender.js';
import { startRecoveryKeyReminderScheduler } from './scheduler/recovery-key-reminders.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to start the API server.`);
  }
  return value;
}

const appBaseUrl = requireEnv('APP_BASE_URL');

// The restricted app_user connection every request handler uses,
// including the email-OTP route's own email-sending — integration_credentials
// is deliberately not RLS-scoped (M0-010) and app_user already has SELECT
// on it, so there's no reason for this request-time path to reach for the
// privileged connection the scheduler below needs for its own, genuinely
// different (cross-tenant) reason.
const appDb = createAppDb(requireEnv('APP_DATABASE_URL'));

const app = buildApp({
  db: appDb,
  apiBaseUrl: requireEnv('API_BASE_URL'),
  appBaseUrl,
  useSecureCookies: process.env.NODE_ENV === 'production',
  cookieSigningSecret: requireEnv('COOKIE_SIGNING_SECRET'),
  emailSender: new ResendEmailSender(appDb),
});

// M3-004 — the Recovery Key reminder sweep is a genuinely cross-tenant
// read (every account, not one request's own tenant), so it needs its own
// privileged/owner connection, never the RLS-scoped one `buildApp` above
// uses for request handlers. Same connection role `db/migrate.ts` uses,
// just held open for the process's lifetime instead of one script run.
const ownerDb = drizzle(postgres(requireEnv('DATABASE_URL')), { schema });
const stopReminderScheduler = startRecoveryKeyReminderScheduler(
  ownerDb,
  new ResendEmailSender(ownerDb),
  appBaseUrl,
  app.log,
);

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  stopReminderScheduler();
});

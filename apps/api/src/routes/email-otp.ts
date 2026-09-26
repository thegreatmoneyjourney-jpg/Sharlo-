import type { FastifyInstance } from 'fastify';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import type * as schema from '../db/schema.js';
import { requestEmailOtp, verifyEmailOtp } from '../auth/email-otp.js';
import { createSession } from '../auth/session.js';
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../auth/request-session.js';
import type { EmailSender } from '../email/email-sender.js';

type Db = PostgresJsDatabase<typeof schema>;

const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // matches session.ts's SESSION_DURATION_MS, same as the Google OAuth callback

const requestBodySchema = z.object({ email: z.string().email() });
const verifyBodySchema = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) });

export interface EmailOtpRoutesOptions {
  db: Db;
  emailSender: EmailSender;
  useSecureCookies: boolean;
}

/**
 * `M3-005`/`ADR-0018` — passwordless email+OTP sign-in for local-only
 * accounts. Both routes are rate-limited (`NFR-SEC-04`) via
 * `@fastify/rate-limit`, registered in `app.ts` with `global: false` so it
 * only applies here, not retroactively to every existing route (a broader
 * rate-limiting pass across the whole API is real, separate hardening
 * work for `M7`'s security sweep, not silently expanded into this task).
 *
 * `/request` always returns the same generic response regardless of
 * whether the email has an account or the send actually succeeded
 * server-side — deliberately: this endpoint must never be usable to probe
 * "does an account exist for this email."
 */
export async function emailOtpRoutes(
  app: FastifyInstance,
  opts: EmailOtpRoutesOptions,
): Promise<void> {
  const { db, emailSender, useSecureCookies } = opts;

  app.post(
    '/auth/email-otp/request',
    // Per-IP: 5 requests per 15 minutes. Complemented by requestEmailOtp's
    // own per-email invalidation of prior codes (not a rate limit itself,
    // but it stops multiple outstanding codes for one email accumulating).
    { preHandler: app.rateLimit({ max: 5, timeWindow: '15 minutes' }) },
    async (req, reply) => {
      const parsed = requestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      await requestEmailOtp(db, emailSender, parsed.data.email);
      return reply.code(200).send({ ok: true });
    },
  );

  app.post(
    '/auth/email-otp/verify',
    // Per-IP: 10 attempts per 15 minutes — deliberately looser than the
    // request endpoint (a real user retyping a mistyped code needs a few
    // tries), with the real brute-force protection being the per-code
    // attempt cap in verifyEmailOtp itself, not this alone.
    { preHandler: app.rateLimit({ max: 10, timeWindow: '15 minutes' }) },
    async (req, reply) => {
      const parsed = verifyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const result = await verifyEmailOtp(db, parsed.data.email, parsed.data.code);
      if (result.outcome !== 'success') {
        return reply.code(400).send({ error: result.outcome });
      }

      const session = await createSession(db, result.userId);
      reply
        .setCookie(SESSION_COOKIE_NAME, session.token, {
          httpOnly: true,
          secure: useSecureCookies,
          sameSite: 'lax',
          signed: true,
          path: '/',
          maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
        })
        .setCookie(CSRF_COOKIE_NAME, session.csrfToken, {
          httpOnly: false,
          secure: useSecureCookies,
          sameSite: 'lax',
          path: '/',
          maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
        });
      return reply.code(200).send({ ok: true });
    },
  );
}

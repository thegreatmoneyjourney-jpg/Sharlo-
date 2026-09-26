import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';

/**
 * Connects as the restricted `app_user` role (ARCHITECTURE.md §8) — never
 * the migration/owner role, which Postgres exempts from RLS by default
 * regardless of policies. This is the connection every request handler uses.
 */
export function createAppDb(connectionString: string): PostgresJsDatabase<typeof schema> {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

/**
 * Sets one or more session-local GUCs (`SET LOCAL` via `set_config(..., true)`
 * per entry, so none can ever leak across pooled-connection reuse into an
 * unrelated request) for the lifetime of one transaction, then runs `fn`
 * inside it. Each GUC name is passed as a bound parameter to `set_config`
 * itself, not spliced into SQL text — safe because `set_config` takes it as
 * an ordinary text argument, unlike a literal `SET LOCAL <name> = ...`
 * statement would.
 *
 * Shared by every "prove who you are via X, then act" pattern this app
 * needs (tenant identity via a validated session, a session via its raw
 * cookie token, a user account via its Google subject id before any
 * session/tenant context exists yet) — see the named wrappers below for
 * what each one is actually for and why each is a real, separate need, not
 * copies of the same thing. Accepts more than one GUC because Postgres RLS
 * requires an UPDATE/DELETE target row to be visible per an applicable
 * *SELECT*-side policy, in addition to satisfying the UPDATE/DELETE
 * policy's own `USING` clause — for a table like `sessions`, whose SELECT
 * and DELETE policies are deliberately scoped against *different* GUCs
 * (see that table's own doc comment), a delete needs both set at once, or
 * the row stays invisible and the delete silently affects zero rows (no
 * error — this is exactly the bug `M3-001`/`M3-002`'s report documents
 * finding via a real, CI-caught test failure, not a documentation read).
 */
async function withGucContext<T>(
  db: PostgresJsDatabase<typeof schema>,
  gucs: Record<string, string>,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    for (const [gucName, gucValue] of Object.entries(gucs)) {
      await tx.execute(sql`select set_config(${gucName}, ${gucValue}, true)`);
    }
    return fn(tx as unknown as PostgresJsDatabase<typeof schema>);
  });
}

/** Every ordinary tenant-scoped query, once a session has already established `userId`. */
export async function withTenantContext<T>(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return withGucContext(db, { 'app.current_user_id': userId }, fn);
}

/**
 * `sessions`' own RLS policy (schema.ts's doc comment on that table) can't
 * use `app.current_user_id` for its main lookup — that claim is only known
 * *after* a session is validated, and validating the session is what this
 * lookup is for. Scoped instead against `app.session_lookup_token`, set to
 * the raw cookie token being looked up right before the query.
 */
export async function withSessionLookupContext<T>(
  db: PostgresJsDatabase<typeof schema>,
  token: string,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return withGucContext(db, { 'app.session_lookup_token': token }, fn);
}

/**
 * Deleting a session needs *both* GUCs at once: `session_lookup_token` so
 * the row is visible at all (Postgres's DELETE-target visibility check —
 * see `withGucContext`'s own comment for why this is required, found via a
 * real test failure, not assumed), and `current_user_id` so the delete
 * policy's own ownership check (only the session's own user may remove it)
 * still applies on top, not weakened by adding the first GUC.
 */
export async function withSessionDeleteContext<T>(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  token: string,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return withGucContext(
    db,
    { 'app.session_lookup_token': token, 'app.current_user_id': userId },
    fn,
  );
}

/**
 * The exact same chicken-and-egg problem as `sessions`' lookup, one layer
 * earlier: signing in checks "does an account for this Google subject id
 * already exist" *before* any user id — and therefore any tenant context —
 * exists to check it with (`M3-001`/`M3-002`'s report has the full story of
 * how this was found: it wasn't exercised by `M0-006`'s original RLS proof,
 * which only ever read *already-seeded* fixture rows over the privileged
 * connection, never inserted a brand-new user over the restricted one).
 * Scoped against `app.google_sub_lookup`, alongside `users`' existing
 * self-access policy — both are permissive SELECT policies, so a row is
 * visible if *either* matches (Postgres ORs permissive policies together),
 * which is exactly "your own row once you know your id, or a row matching
 * the Google subject you're currently signing in with."
 */
export async function withGoogleSubLookupContext<T>(
  db: PostgresJsDatabase<typeof schema>,
  googleSub: string,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return withGucContext(db, { 'app.google_sub_lookup': googleSub }, fn);
}

/**
 * `M3-005`/`ADR-0018` — the same lookup-before-identity shape as
 * `withGoogleSubLookupContext` above, for the email-OTP sign-in path:
 * verifying a code has to check "does an account for this email already
 * exist" before any user id exists to scope the query with. Scoped
 * against `app.email_lookup`, alongside `users`' own self-access and
 * google_sub-lookup policies (all permissive SELECT policies, ORed).
 */
export async function withEmailLookupContext<T>(
  db: PostgresJsDatabase<typeof schema>,
  email: string,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return withGucContext(db, { 'app.email_lookup': email }, fn);
}

/**
 * `M3-005`/`ADR-0018` — `email_otp_codes`' own lookup GUC, used for every
 * operation on that table (request writes a new row, verify reads and
 * updates the matching one) — see that table's own doc comment in
 * `schema.ts` for why this isn't a meaningful access-control boundary by
 * itself (the real protection is the code + expiry + attempts + rate
 * limiting), only defense against a buggy/missing `WHERE` clause.
 */
export async function withOtpEmailLookupContext<T>(
  db: PostgresJsDatabase<typeof schema>,
  email: string,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return withGucContext(db, { 'app.otp_email_lookup': email }, fn);
}

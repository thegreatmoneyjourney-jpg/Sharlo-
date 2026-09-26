import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// drizzle-orm/pg-core has no built-in `bytea` column helper (unlike jsonb,
// text, etc.) — this is the documented way to declare one: a `customType`
// mapping directly to Postgres's own `bytea`, in/out as a Node `Buffer`.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Minimal `users` table per ARCHITECTURE.md §6 — the M0-006 proof-of-concept
 * slice, not the full account schema (school_id FK, subscriptions, etc. land
 * with M3/M4). Deliberately holds only what §4's data classification allows
 * server-side: wrapped-key ciphertext and KDF params, never plaintext key
 * material, never student data.
 *
 * RLS policy shape here is a special case worth flagging: this table's own
 * `id` IS the tenant identifier (a user can only see their own account row),
 * so the policy compares `id` directly to the session's current-user claim.
 * Every other tenant-scoped table added later (subscriptions, usage_counters,
 * templates, ...) will instead have a separate `user_id` FK column and its
 * policy will compare THAT column, not its own `id` — don't copy this exact
 * predicate onto a table where `id` isn't the tenant identity.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    googleSub: text('google_sub').unique(),
    authMode: text('auth_mode', { enum: ['google', 'local_only'] }).notNull(),
    accountType: text('account_type', {
      enum: ['teacher', 'school_admin', 'platform_admin'],
    })
      .notNull()
      .default('teacher'),
    // wrapped_master_key_by_passphrase / _by_recovery: ciphertext only (ADR-0005).
    // We can store these server-side precisely because we cannot unwrap them.
    wrappedMasterKeyByPassphrase: text('wrapped_master_key_by_passphrase'),
    wrappedMasterKeyByRecovery: text('wrapped_master_key_by_recovery'),
    kdfSalt: text('kdf_salt'),
    kdfParams: jsonb('kdf_params'),
    recoveryKeyVerifier: text('recovery_key_verifier'),
    // ADR-0005 addendum: Recovery Key reminder cadence.
    recoveryKeyIssuedAt: timestamp('recovery_key_issued_at', { withTimezone: true }),
    recoveryKeyReminder7dSentAt: timestamp('recovery_key_reminder_7d_sent_at', {
      withTimezone: true,
    }),
    recoveryKeyReminder30dSentAt: timestamp('recovery_key_reminder_30d_sent_at', {
      withTimezone: true,
    }),
    recoveryKeyReminderDismissedAt: timestamp('recovery_key_reminder_dismissed_at', {
      withTimezone: true,
    }),
    // M3-001 — encrypted at rest with the same AES-256-GCM primitive as
    // `integration_credentials` (`../integrations/credential-store.ts`'s
    // functions, reused directly rather than a second key-management
    // scheme for what's the same underlying requirement: a secret the
    // server must read in plaintext to do its job). NOT stored in that
    // table itself — this is a *per-user* Google OAuth credential, not
    // platform-level integration config, so it gets its own nullable
    // column here instead (null for `local_only` accounts, which have no
    // Google tokens at all). Requested with `access_type=offline` +
    // `prompt=consent` at sign-in specifically so a refresh token exists
    // to store — Google only issues one on that combination, and
    // discarding it here would force a full re-consent flow later just to
    // add the M3-006 Drive-access-token-refresh endpoint this is meant to
    // eventually feed (that endpoint is M3-006's own scope, not built yet).
    googleRefreshTokenEncrypted: bytea('google_refresh_token_encrypted'),
    schemaVersion: integer('schema_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Fails closed by design (ADR-0008): nullif(...) normalizes BOTH cases
    // where there's no real tenant claim down to NULL, and `id = NULL` is
    // never true. Two cases, not one — worth being explicit about why both
    // are handled: (1) a genuinely fresh connection that never touched
    // app.current_user_id, where current_setting(..., true) returns NULL;
    // and (2) — the one a naive `::uuid` cast on current_setting() alone
    // gets wrong — a *pooled* connection that previously ran a request
    // inside withTenantContext's `SET LOCAL`-scoped transaction: once a
    // custom GUC has been touched at all on a connection, Postgres resets
    // it to '' (empty string), not back to NULL, when that transaction
    // ends. An empty string cast straight to ::uuid throws a hard error
    // instead of safely denying — caught by this table's own RLS test
    // (test/rls.test.ts) hitting exactly this via connection-pool reuse,
    // the same pooling this table's real callers (the Fastify app) use.
    pgPolicy('users_self_access_only', {
      for: 'all',
      to: 'app_user',
      using: sql`${table.id} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
    }),
    // M3-001/M3-002: signing in has to check "does an account for this
    // Google subject id already exist" *before* any user id — and
    // therefore any tenant context — exists to check it with. A second,
    // separate permissive SELECT policy (Postgres ORs permissive policies
    // together, so this adds a row's visibility, never subtracts from the
    // policy above) scoped against its own GUC
    // (`../db/client.ts`'s `withGoogleSubLookupContext`), the exact same
    // shape as `sessions`' own lookup-before-identity problem. Never
    // matches a `google_sub IS NULL` row (a local-only account) — nullif
    // normalizes an unset GUC to NULL, and `NULL = NULL` is never true in
    // SQL, so this can't be tricked into returning every passwordless row.
    pgPolicy('users_select_by_google_sub_lookup', {
      for: 'select',
      to: 'app_user',
      using: sql`${table.googleSub} = nullif(current_setting('app.google_sub_lookup', true), '')`,
    }),
  ],
).enableRLS();

/**
 * M2-001/M2-002 — geometry + printable PDFs for the Sharlo stock
 * templates live in `apps/web/lib/templates/`; this table stores the
 * (opaque-to-the-API) `geometry` JSONB blob plus enough metadata to list
 * and select templates. See `docs/reports/SHARLO-M2-002.md`.
 *
 * RLS policy shape here is genuinely different from `users`': this table
 * mixes two kinds of row in one place — `owner_id IS NULL` (a Sharlo
 * stock template, visible to *every* tenant) and `owner_id = <teacher>`
 * (that teacher's own custom template, `FR-TPL-02`, visible only to
 * them) — so a single blanket "row belongs to you" predicate like
 * `users`' policy would incorrectly hide every stock template from
 * everyone. Split into per-operation policies instead of one `for: 'all'`
 * policy, because the *read* rule (own-or-stock) and the *write* rules
 * (own-only, full stop) are genuinely different predicates, not the same
 * one reused: an `app_user`-authenticated request must never be able to
 * insert, update, or delete a stock template — those are seeded through
 * the privileged migration-owner connection only (`seed-stock-templates.ts`),
 * which bypasses RLS by default the same way migrations already do.
 */
export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id), // null = Sharlo stock template
    name: text('name').notNull(),
    questionCount: integer('question_count').notNull(),
    geometry: jsonb('geometry').notNull(), // corner markers + bubble grid — see apps/web/lib/templates/geometry.ts; no student data
    isStock: boolean('is_stock').notNull().default(false),
    schemaVersion: integer('schema_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy('templates_select_own_or_stock', {
      for: 'select',
      to: 'app_user',
      using: sql`${table.ownerId} is null or ${table.ownerId} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
    }),
    // WITH CHECK (not USING) governs INSERT: the *new* row's owner_id
    // must equal the caller's own id, which also means it can never be
    // NULL — an app_user connection can never insert a stock template.
    pgPolicy('templates_insert_own_only', {
      for: 'insert',
      to: 'app_user',
      withCheck: sql`${table.ownerId} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
    }),
    // UPDATE needs both: USING picks which existing rows are even
    // reachable (only your own — never a stock template), WITH CHECK
    // stops a reachable row from being *rewritten* to a different
    // owner_id (e.g. NULL, which would otherwise let a teacher "promote"
    // their own template into a stock one everybody sees).
    pgPolicy('templates_update_own_only', {
      for: 'update',
      to: 'app_user',
      using: sql`${table.ownerId} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
      withCheck: sql`${table.ownerId} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
    }),
    pgPolicy('templates_delete_own_only', {
      for: 'delete',
      to: 'app_user',
      using: sql`${table.ownerId} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
    }),
    // Partial index — unique only *among stock templates* (is_stock =
    // true), not a global name constraint that would stop two different
    // teachers each naming a custom template "Midterm". Lets the seed
    // script (seed-stock-templates.ts) upsert on conflict and stay
    // idempotent (same 3 rows, same ids, safe to rerun) instead of
    // accumulating duplicates or rotating ids on every reseed.
    uniqueIndex('templates_stock_name_unique')
      .on(table.name)
      .where(sql`${table.isStock} = true`),
  ],
).enableRLS();

/**
 * M0-010 / ADR-0017 — every third-party integration secret (Resend, Paddle,
 * Bank Alfalah, the ADR-0016 AI provider, Google OAuth's client secret, any
 * future one) lives here, encrypted, instead of a hardcoded env var that'd
 * need a redeploy to rotate. `encryptedValue` is AES-256-GCM ciphertext —
 * see `../integrations/credential-store.ts` for the encrypt/decrypt helpers
 * and the *one* secret that's still a real env var on purpose (the envelope
 * key protecting this table, which is standard envelope-encryption practice,
 * not a violation of the ADR's own goal — see that file's module comment).
 *
 * Deliberately **not** RLS-enabled. RLS in this codebase (see `users`,
 * `templates` above) enforces *per-tenant* row isolation via
 * `app.current_user_id`; this table isn't tenant-scoped data at all — it's
 * platform-level configuration no teacher-facing request should ever reach,
 * scoped instead at the application layer: only the credential-store
 * helper module reads/writes it, and no teacher-facing route is ever wired
 * to touch it. `updatedBy` is nullable (a bootstrap/CLI write, `M0-010`'s
 * "minimal write path," has no acting admin user yet — `M5-012`'s admin UI
 * is what populates it going forward).
 */
export const integrationCredentials = pgTable(
  'integration_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(), // 'resend' | 'paddle' | 'bank_alfalah' | 'ai_support' | 'google_oauth' | ...
    keyName: text('key_name').notNull(), // e.g. 'api_key', 'client_id', 'client_secret', 'webhook_secret'
    encryptedValue: bytea('encrypted_value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (table) => [
    uniqueIndex('integration_credentials_provider_key_unique').on(table.provider, table.keyName),
  ],
);

/**
 * M3-001/M3-002 (`ARCHITECTURE.md` §9) — one row per signed-in session.
 * `token` is the high-entropy random value inside the httpOnly session
 * cookie (never a UUID — 122 bits, structured, and guessable-in-principle
 * in a way a 256-bit random token isn't); `csrfToken` backs the
 * double-submit CSRF check on state-changing requests, generated once per
 * session rather than per-request.
 *
 * RLS here needs a genuinely different policy shape from every other
 * table, because of a chicken-and-egg problem the others don't have:
 * every other table's policy trusts `app.current_user_id`, a claim set
 * *after* a session is already validated — but validating the session is
 * exactly the operation that hasn't happened yet when this table's main
 * lookup (raw cookie token → which user is this?) runs. Comparing against
 * `current_user_id` here would be circular.
 *
 * Instead, SELECT is scoped against a *different* GUC, `app.session_lookup_token`
 * (see `../auth/session.ts`), set to the raw token being looked up right
 * before the query — so even a future bug that dropped the query's own
 * `WHERE token = ...` clause could still only ever see the one row matching
 * that exact token, never the whole table. This is the same "fail closed
 * even if the app-layer query is wrong" property RLS gives every other
 * table, extended to a table whose access pattern is structurally
 * different. INSERT (issuing a new session, right after OAuth identifies
 * the user) and DELETE (logout) *do* have a `current_user_id` available by
 * then, so they use the normal predicate.
 */
export const sessions = pgTable(
  'sessions',
  {
    token: text('token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    csrfToken: text('csrf_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    pgPolicy('sessions_select_by_lookup_token', {
      for: 'select',
      to: 'app_user',
      using: sql`${table.token} = nullif(current_setting('app.session_lookup_token', true), '')`,
    }),
    pgPolicy('sessions_insert_own_only', {
      for: 'insert',
      to: 'app_user',
      withCheck: sql`${table.userId} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
    }),
    pgPolicy('sessions_delete_own_only', {
      for: 'delete',
      to: 'app_user',
      using: sql`${table.userId} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
    }),
  ],
).enableRLS();

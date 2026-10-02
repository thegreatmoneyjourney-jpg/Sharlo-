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
    // M3-005/ADR-0018 — HOW this account authenticates, independent of
    // auth_mode (WHERE its student data lives). Today the two are 1:1
    // ('google'<->'google', 'local_only'<->'email_otp') but are kept as
    // separate columns on purpose: a possible future "local-only account
    // links Google Drive" flow should be able to change one without
    // touching the other, rather than needing a schema change to
    // introduce that distinction later. See ADR-0018's "Future: account
    // linking" section — not built yet, just not ruled out.
    authProvider: text('auth_provider', { enum: ['google', 'email_otp'] }).notNull(),
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
    // M3-005/ADR-0018 — the exact same chicken-and-egg problem as the
    // google_sub lookup above, one layer earlier for the email-OTP path:
    // verifying a code needs to check "does an account for this email
    // already exist" before any user id (and therefore any tenant
    // context) exists to scope the query with. A third permissive SELECT
    // policy (still ORed with the other two, per Postgres's own semantics
    // for multiple permissive policies), scoped against its own GUC
    // (`app.email_lookup`, `../db/client.ts`'s `withEmailLookupContext`).
    pgPolicy('users_select_by_email_lookup', {
      for: 'select',
      to: 'app_user',
      using: sql`${table.email} = nullif(current_setting('app.email_lookup', true), '')`,
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

/**
 * `M3-005`/`ADR-0018` — one row per requested email-OTP sign-in code.
 * `codeHash` is a hash, never the raw code — real defense-in-depth here
 * (the actual protection against brute-force is `attempts` + `expiresAt` +
 * the request/verify endpoints' own rate limiting, not this hash's
 * strength against a 6-digit space, which is small by design; see the ADR).
 * No `user_id` column: a code can be requested for an email that doesn't
 * have a `users` row yet (a brand-new local-only signup) — the row this
 * table's about is purely "an email proved control of its inbox," which
 * `../auth/email-otp.ts` turns into a `users` row (new or existing) only
 * *after* successful verification, never before.
 *
 * RLS here is the same "chicken-and-egg, scope by a purpose-specific GUC"
 * shape as `users`' own email/google_sub lookup policies and `sessions`'
 * token lookup — `app.otp_email_lookup`, set to the target email right
 * before the query, for every operation this table needs (request writes
 * a new row, verify reads+updates the matching one). This is *not* a
 * meaningful access-control boundary by itself (anyone can set this GUC to
 * any email — there's no proof-of-identity at this layer), the same as
 * `google_sub_lookup`/`email_lookup` aren't: it's defense against a buggy
 * or missing `WHERE` clause ever returning more than one email's own rows,
 * not the actual security boundary (that's the code + expiry + attempts).
 */
export const emailOtpCodes = pgTable(
  'email_otp_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy('email_otp_codes_by_email_lookup', {
      for: 'all',
      to: 'app_user',
      using: sql`${table.email} = nullif(current_setting('app.otp_email_lookup', true), '')`,
      withCheck: sql`${table.email} = nullif(current_setting('app.otp_email_lookup', true), '')`,
    }),
  ],
).enableRLS();

/**
 * `M3-014`/`ADR-0010` — one row per School account. `adminUserId` is the
 * tenant identifier here (the `templates`-style "separate FK column, not
 * this table's own `id`" shape `schema.ts`'s own module comments already
 * call out) — a teacher-under-school's own row lives on `users` as
 * always; `school_members` (below, `M3-015`) links a teacher to the
 * school they joined. This table deliberately has no teacher-facing
 * policy of its own — see `school_members`'s own doc comment for why
 * (real Postgres RLS recursion, not an oversight) and where a teacher's
 * reads of school data actually come from instead.
 *
 * Both key-material columns are opaque ciphertext/public-key bytes this
 * table's RLS policy protects the same way `users`' own wrapped-key
 * columns are protected — nothing here is plaintext key material, so
 * storing it server-side doesn't violate the zero-knowledge architecture.
 *
 * **Deviates from ADR-0010's literal `school_wrapped_key_by_admin_passphrase`
 * column name/mechanism** — resolved here, not guessed at: the school key
 * is wrapped under the admin's *master key* (an AES-256-GCM wrap via the
 * exact primitive `lib/crypto/aes-gcm.ts` already provides, reusing the
 * admin's already-unlocked session key, `lib/crypto/master-key-session.ts`)
 * rather than re-deriving a passphrase-KEK and (separately) wrapping by the
 * raw Recovery Key a second time. The master key is already the *one*
 * thing both the Encryption Passphrase and the Recovery Key can unlock
 * (that's the entire point of `users`' own dual-wrap design) — wrapping
 * under it gives the school key the identical dual-recovery property ADR-0010
 * asks for ("same mechanism as ADR-0005") via one wrap operation instead of
 * two, and sidesteps a real problem the literal two-separate-wraps reading
 * would hit: the raw Recovery Key is never retained in memory after its
 * one-time initial issuance (`M3-003`'s own established design), so it
 * simply isn't available at an arbitrary later moment like school creation
 * without an unplanned "re-enter your Recovery Key right now" step nothing
 * in ADR-0010's actual onboarding flow describes. The admin's X25519
 * keypair (for the `M3-015`/`016` sealed-box teacher-to-admin key-sharing
 * mechanism, Addendum 9's own resolution of a separate ADR-0010 gap) is
 * protected the identical way for the identical reason. See
 * `docs/reports/SHARLO-M3-014.md` and the ADR-0010 addendum this task adds.
 */
export const schools = pgTable(
  'schools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => users.id),
    // 'shared_drive' | 'folder' — ADR-0010's Workspace-vs-personal-account
    // branch. driveLocationId is the Shared Drive id or the folder's file
    // id, depending on which.
    driveLocationType: text('drive_location_type', { enum: ['shared_drive', 'folder'] }).notNull(),
    driveLocationId: text('drive_location_id').notNull(),
    // Hex AES-256-GCM ciphertext (`aes-gcm.ts`'s combined iv||ciphertext+authTag
    // blob) — the school key wrapped under the admin's master key. See this
    // table's own doc comment above for why this, not two separate wraps.
    schoolWrappedKeyByAdminMasterKey: text('school_wrapped_key_by_admin_master_key').notNull(),
    // Hex-encoded X25519 public key — not a secret, servable to any
    // authenticated teacher who needs it to seal a school-key copy to this
    // admin (`M3-015`/`016`). Cleartext is correct here, same as a TLS
    // certificate's public key being servable to anyone.
    adminX25519PublicKey: text('admin_x25519_public_key').notNull(),
    // Hex AES-256-GCM ciphertext — the X25519 *private* key wrapped under
    // the admin's master key, same reasoning as schoolWrappedKeyByAdminMasterKey.
    adminX25519WrappedPrivateKey: text('admin_x25519_wrapped_private_key').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // for: 'all' with only USING: Postgres applies the same predicate to
    // WITH CHECK when none is given (the same reliance `users`' own
    // self-access policy above already has) — correct here since there's
    // only one access pattern this task needs (an admin's own school rows),
    // unlike `templates`' own-or-stock split.
    pgPolicy('schools_admin_access_only', {
      for: 'all',
      to: 'app_user',
      using: sql`${table.adminUserId} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
    }),
  ],
).enableRLS();

/**
 * `M3-015`/`ADR-0010` — links a teacher (`userId`) to the school they
 * joined. One row per teacher *ever* (a unique index on `userId` alone,
 * not a composite `(userId, schoolId)` key) — nothing in `ADR-0010`/
 * `FR-SCHOOL-*` describes a teacher belonging to two schools at once, so
 * this table enforces "at most one school per teacher" structurally
 * rather than leaving it to application code to remember.
 *
 * **`schools` deliberately does NOT get a teacher-facing SELECT policy —
 * found to be impossible, not just unbuilt.** A first attempt gave
 * `schools` a `schools_select_by_membership` policy subquerying
 * `school_members`, while `school_members`'s own admin policy (below)
 * subqueries back into `schools` — real Postgres rejects this with
 * `ERROR: infinite recursion detected in policy for relation "schools"`
 * (confirmed against a live instance in `school-members-rls.test.ts`,
 * not just reasoned through). Postgres's RLS cycle detection is
 * reference-graph-based, not value-based, so an A→B→A policy reference
 * between two RLS-protected tables is rejected outright even though the
 * actual predicates here would terminate. Fixed by never letting a
 * teacher's RLS-scoped connection read `schools` directly at all:
 * `driveLocationType`/`driveLocationId` are copied onto each member's own
 * row below (write-once, at `addTeacherToSchool`/`M3-015`'s own insert
 * time, from the authoritative `schools` row the admin's own RLS-checked
 * connection already read) — a teacher gets everything FR-SCHOOL-02's
 * Picker step needs from their *own* already-safe `school_members` row,
 * with zero cross-table RLS. A future need for a teacher to read the
 * admin's `adminX25519PublicKey` (`M3-016`) should follow the identical
 * pattern — denormalize onto `school_members` at insert time — rather
 * than re-attempting a teacher-facing policy on `schools` itself.
 *
 * `driveAccessGranted` records the one-time Google Picker step
 * (`FR-SCHOOL-02`, `ADR-0010`'s "Access-grant flow" step 3) — `drive.file`
 * only grants access to a resource the app didn't create once the user
 * explicitly selects it via the Picker, which our server can't observe
 * directly. This column is the server's record of "has the teacher's
 * browser told us it did that," never itself the real security boundary
 * (Google's own grant is) — same "not a boundary by itself, the code is"
 * framing `M3-001`'s `google_sub_lookup` GUC already established.
 *
 * `school_members_self_update`'s `WITH CHECK` only restricts `userId`,
 * not which *other* columns a teacher's own-row update may touch (Postgres
 * RLS has no column-level USING/CHECK) — deliberately left coarse, the
 * same "RLS is tenant isolation, application code is the fine-grained
 * guard" split `sessions_insert_own_only` already relies on: the actual
 * confirm-access endpoint (`M3-015`'s own API route) never accepts a
 * client-supplied `schoolId`/`driveLocationType`/`driveLocationId`, so
 * there's no real path to exploit the extra breadth even though the
 * policy alone permits it.
 */
export const schoolMembers = pgTable(
  'school_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id),
    // Denormalized copy of the school's own columns, written once at
    // insert time — see this table's own doc comment above for why
    // (avoids a teacher-facing policy on `schools` entirely, which real
    // Postgres rejects as circular). Never updated after insert; if a
    // school ever changed its Drive container (not a feature that exists),
    // re-adding affected members would be the mechanism, not an UPDATE.
    driveLocationType: text('drive_location_type', { enum: ['shared_drive', 'folder'] }).notNull(),
    driveLocationId: text('drive_location_id').notNull(),
    // Denormalized copy of `users.email` at insert time — the *same*
    // reasoning, one layer earlier: `users`' own RLS (self-access, plus
    // the two single-value lookup GUCs) has no policy that lets an
    // admin's tenant-scoped connection see *another* user's row at all,
    // so an admin's members-list read can never join out to `users` for
    // a teacher's email either, not just `schools`. Copied once from the
    // email the admin looked the teacher up by (`addTeacherToSchool`,
    // `M3-015`), never re-read live.
    email: text('email').notNull(),
    driveAccessGranted: boolean('drive_access_granted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Admin manages every member of schools *they* admin — the first
    // subquery-based policy in this file (every earlier policy compares a
    // column directly to a session GUC); Postgres evaluates this subquery
    // under the same `app_user` role's own RLS, so it composes rather than
    // needing a bypass. `schools` is already defined above, so a typed
    // column ref is safe here (no temporal-dead-zone issue in this
    // direction).
    pgPolicy('school_members_admin_manages_own_school', {
      for: 'all',
      to: 'app_user',
      using: sql`${table.schoolId} in (select ${schools.id} from ${schools} where ${schools.adminUserId} = nullif(current_setting('app.current_user_id', true), '')::uuid)`,
    }),
    // A teacher sees and can update only their *own* membership row (e.g.
    // flipping `driveAccessGranted`) — never insert/delete it themselves;
    // with no teacher policy covering those two actions, RLS's default-deny
    // blocks them, leaving add/remove exclusively to the admin policy above.
    pgPolicy('school_members_self_select', {
      for: 'select',
      to: 'app_user',
      using: sql`${table.userId} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
    }),
    pgPolicy('school_members_self_update', {
      for: 'update',
      to: 'app_user',
      using: sql`${table.userId} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
      withCheck: sql`${table.userId} = nullif(current_setting('app.current_user_id', true), '')::uuid`,
    }),
  ],
).enableRLS();

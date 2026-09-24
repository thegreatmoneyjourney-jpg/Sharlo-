import { sql } from 'drizzle-orm';
import { integer, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
  ],
).enableRLS();

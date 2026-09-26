# Sharlo — System Architecture

**Status:** Draft v1.0 for founder review. Companion to `docs/SRS.md` (requirements) and `docs/ADR/` (decision records with full rationale). Sections marked **[DECISION NEEDED]** are proposals, not settled facts — see `docs/reports/SHARLO-M0-001.md` for the consolidated list.

---

## 1. Goals this architecture optimizes for

In priority order, because they occasionally trade off against each other:

1. **Our servers must be architecturally incapable of reading student data.** Not a policy — a structural property of the system, checkable by reading the code.
2. **Near-zero marginal cost per scan.** No server-side image processing, no third-party vision/OCR API calls, ever.
3. **Near-zero infrastructure cost at low-to-mid scale.** Small VPS, no managed BaaS, no per-seat SaaS tooling we don't need yet.
4. **Solo-founder operability.** Few moving parts, boring technology, strong defaults over configurability, because there's no ops team.
5. **Correctness and safety of the multi-tenant and billing logic**, since that's where a bug is expensive (either a data leak or a revenue leak) even though it's the "boring" 20% of the product.

---

## 2. High-level system map

```
                        ┌─────────────────────────────────────────┐
                        │              Teacher's Browser            │
                        │                                             │
                        │  Next.js app (scanning UI, results UI)     │
                        │  OpenCV.js (WASM) — all image analysis     │
                        │  Master key + AES-256-GCM encrypt/decrypt  │
                        │                                             │
                        └───────┬───────────────────┬─────────────────┘
                                │                     │
                 (A) Encrypted student/exam data   (B) Account, billing, admin,
                     — direct browser↔Drive,           usage counters, templates
                     backend NEVER touches this           (non-sensitive)
                                │                     │
                                ▼                     ▼
                  ┌───────────────────────┐   ┌───────────────────────────┐
                  │  Teacher's own Google   │   │   Sharlo API (Fastify)     │
                  │  Drive (drive.file       │   │   on a Hetzner VPS         │
                  │  scope) — OR browser     │   │                             │
                  │  IndexedDB in local-only │   │  Postgres (accounts,       │
                  │  mode                    │   │  subscriptions, tenants,   │
                  └───────────────────────┘   │  audit log, feature flags,  │
                                                 │  pricing config)            │
                                                 │                             │
                                                 │  Object storage (template   │
                                                 │  geometry — non-sensitive)  │
                                                 └──────────┬──────────────────┘
                                                             │
                                          ┌──────────────────┴──────────────────┐
                                          ▼                                       ▼
                                 ┌────────────────┐                    ┌──────────────────┐
                                 │  Paddle (MoR)    │                    │  Bank Alfalah      │
                                 │  global billing   │                    │  Pakistan PKR       │
                                 └────────────────┘                    └──────────────────┘
```

The line between (A) and (B) is the single most important line in this system. Everything in this document defends it.

---

## 3. Frontend architecture

**Framework:** Next.js (App Router), React, TypeScript, strict mode. SSR for the marketing site and any crawlable page; the scanning/results app itself is naturally client-heavy (camera, WASM, crypto) but still served through Next.js so auth, routing, and the marketing site share one codebase and deploy pipeline. See ADR-0002.

Top-level structure — **corrected during M0 scaffolding** from an earlier single-tree sketch: `web` and `api` are genuinely separate deployables (separate Docker Compose services per §12, separate `package.json`s, separate release cadence), so they're two packages in an npm workspaces monorepo, not one folder tree:

```
/apps
  /web                    -- Next.js app (npm workspace "web")
    /app
      /(marketing)          -- SSR'd public pages: home, pricing, features, blog, legal
      /(app)                -- authenticated teacher app (mostly client components)
        /scan                -- live camera + auto-capture flow
        /exams/[id]/review    -- Review Needed queue
        /exams/[id]/results   -- results table + analytics + FR-ANALYTICS
        /exams/[id]/import     -- FR-IMPORT: manual import, column mapping, validation
        /classes                -- FR-ATTEND: class management + daily/exam-day attendance
        /templates                -- template library + custom template builder
        /settings                 -- account, encryption passphrase, recovery key, billing
      /(publish)             -- FR-PUBLISH: public STRAI check page — the one route tree
                                  that's intentionally NOT behind auth, see §7a
      /(school)              -- principal/school-admin views
      /(admin)               -- separate deployment target / subdomain, see §11
    /lib
      /scanning               -- OpenCV.js pipeline, corner detection, grid sampling
      /crypto                 -- key generation, wrapping/unwrapping, AES-GCM helpers
      /drive                  -- Drive file CRUD (browser-direct, no backend proxy)
      /local-store             -- IndexedDB adapter for local-only mode
      /billing                 -- entitlement checks, plan/usage helpers
      /results-grid             -- FR-IMPORT-06: the ONE editable-grid component, used by
                                    both /exams/[id]/results and /exams/[id]/import — never
                                    forked into two implementations
  /api                     -- Fastify app (npm workspace "api")
    /src
      /routes                 -- accounts, billing, admin, usage counters (§5),
                                  public-results publish + lookup (§7a, the only
                                  unauthenticated routes in this app)
      /db                       -- Drizzle schema + migrations
      /payments                  -- Paddle + Bank Alfalah adapters behind one interface
/infra                    -- Caddyfile, deployment docs (M0-005) — not a workspace, no app code
docker-compose.yml         -- Postgres + api + web + Caddy, one VPS, per §12
```

The scanning, crypto, and Drive modules are deliberately framework-agnostic (plain TypeScript) so they're independently unit-testable without a browser/DOM, and so the core IP of the product (the detection pipeline) isn't tangled with UI code. As the admin panel (§11) grows, it may warrant becoming its own workspace (`apps/admin`) rather than a route group inside `web` — deferred until M5, not decided now.

`/lib/results-grid` (Addendum 2) is deliberately one component with two call sites, not two components — `FR-IMPORT-06` states this as a requirement, not a suggestion: a fix or accessibility improvement made reviewing scanned results should benefit the import-correction flow for free, and vice versa, because it's the same code.

---

## 4. Client-side scanning engine

Pipeline, per captured frame:

1. **Corner marker detection** — OpenCV.js searches for the 4 fiducial markers defined by the active template. Runs continuously against the live camera feed at ≥10fps (NFR-PERF-03).
2. **Stability gate** — corner positions must stay within a small pixel-delta tolerance for ~500ms before a capture is triggered (FR-SCAN-02). This is what makes auto-capture feel like "zero clicks" instead of grabbing blurry frames.
3. **Perspective transform** — once stable, warp the frame to a normalized top-down rectangle using the 4 corners.
4. **Grid sampling** — using the template's bubble-position geometry, sample each bubble region's fill ratio (e.g., dark-pixel density inside the bubble contour vs. a local background baseline, to stay robust to lighting).
5. **Confidence classification** — each bubble/question becomes one of: _confident-filled_, _confident-empty_, or _ambiguous_ (multiple marks, partial fill, erasure smudge). Thresholds here are the single biggest lever on the NFR-ACC-03 vs. NFR-ACC-04 tradeoff in the SRS and should be tunable constants, not hardcoded magic numbers, so they can be adjusted after M1 real-world testing without a re-architecture.
6. **Scoring** — confident answers are scored immediately against the decrypted answer key held in memory; ambiguous ones are queued to the Review Needed list with a cropped image of just that question.
7. **Roll-number read** — same bubble-grid technique applied to the roll-number block, matched against the decrypted roster.

Custom templates (FR-TPL-02) reuse steps 1–4 in a "detect grid from a blank/sample photo" mode, but always land in a review/adjust UI before being saved — this is a fundamentally harder, less-constrained problem than scoring a known template, so we don't promise unattended accuracy there (SRS FR-TPL-02).

**Why entirely client-side:** see ADR-0001. Short version: any server-side image processing (ours or a third-party OCR/vision API) would (a) cost money per scan, undermining the free-tier economics, (b) require the raw sheet image to leave the browser, breaking the "servers can't read student data" guarantee at the source, and (c) add network latency directly into the 2-second capture budget.

---

## 5. Backend API

**Framework: Fastify + TypeScript + Zod schema validation.** See ADR-0007 for the comparison against NestJS and plain Express. Fastify was chosen for low overhead on a small VPS, first-class TypeScript support, and a plugin model that stays readable for a solo-maintained codebase without NestJS's heavier DI/module ceremony.

**ORM: Drizzle**, chosen over Prisma for explicit SQL, a lighter runtime footprint, and straightforward interop with Postgres Row-Level Security policies (important for §8). See ADR-0007.

The backend's job is deliberately narrow. It **never** receives: raw sheet images, decrypted student data, decrypted exam content, master keys, or wrapping keys. It only ever handles:

- Account lifecycle (create account, store wrapped master-key ciphertext + recovery-key verification hash, profile basics).
- Session issuance/validation (httpOnly signed cookie backed by a `sessions` table).
- Billing (checkout handoff to Paddle/Bank Alfalah, webhook ingestion, entitlement state).
- Usage counters (a number, incremented — see §6 and NFR-SEC-07).
- Template _metadata/geometry_ storage (non-sensitive, §4 of SRS).
- Admin operations (§11).
- Feature flags / pricing config reads.

If a future feature seems to need the backend to see more than this, that's a **[DECISION NEEDED]** moment, not a place to quietly add a field.

---

## 6. Database schema (Postgres)

Deliberately small. Everything here is either non-sensitive or ciphertext-we-cannot-open.

```sql
-- Tenancy & accounts
users (
  id uuid pk, email text unique, google_sub text unique,
  auth_mode text check in ('google','local_only'),      -- WHERE student data lives (Drive vs IndexedDB)
  auth_provider text check in ('google','email_otp'),    -- M3-005/ADR-0018: HOW this account authenticates — a deliberately separate column from auth_mode, see §9
  account_type text check in ('teacher','school_admin','platform_admin'),
  school_id uuid null references schools(id),
  wrapped_master_key_by_passphrase bytea,   -- ciphertext only
  wrapped_master_key_by_recovery bytea,      -- ciphertext only
  kdf_salt bytea, kdf_params jsonb,           -- Argon2id params, not a secret
  recovery_key_verifier bytea,                 -- verifier hash, not the key itself
  google_refresh_token_encrypted bytea,        -- M3-001: encrypted with credential-store.ts's AES-256-GCM helpers (reused, not a second key-management scheme); null for local_only accounts
  schema_version int not null default 1,
  created_at, updated_at
)

sessions (
  -- M3-002. RLS here can't use the usual current_user_id claim for its
  -- own lookup (chicken-and-egg: that claim is only known *after* a
  -- session is validated) — scoped instead against a session_lookup_token
  -- GUC set right before the query. See schema.ts's doc comment on this
  -- table for the full reasoning, and §9 below for how it's used.
  token text pk,                     -- high-entropy random value inside the httpOnly session cookie, never a UUID
  user_id uuid references users(id),
  csrf_token text,                    -- ARCHITECTURE.md §9's double-submit CSRF value, issued once per session
  created_at, expires_at
)

email_otp_codes (
  -- M3-005/ADR-0018: local-only sign-in. Own purpose-scoped lookup GUC
  -- (app.otp_email_lookup), same pattern as sessions/users above — see §9.
  -- Not a meaningful access-control boundary by itself (anyone can claim
  -- any email at this layer); the real protection is expiry + attempts +
  -- rate limiting, code_hash is defense-in-depth on top of that.
  id uuid pk, email text, code_hash text,   -- sha256 of the 6-digit code, never the code itself
  expires_at timestamptz, attempts int default 0, consumed_at timestamptz null,
  created_at
)

schools (
  id uuid pk, name text, min_seats int default 5,
  school_wrapped_key_by_admin_passphrase bytea, -- see ADR-0010
  drive_location_type text check in ('shared_drive','folder'), -- which continuity guarantee applies, see ADR-0010
  drive_location_id text,   -- opaque Google resource ID, non-content pointer (same sensitivity class as `templates`, not exam content)
  created_at, updated_at
)

school_members (
  school_id uuid references schools(id),
  user_id uuid references users(id),
  role text check in ('admin','teacher'),
  school_pubkey_copy bytea,  -- this teacher's copy of the school key material, wrapped to them (ADR-0010)
  primary key (school_id, user_id)
)

-- Billing
subscriptions (
  id uuid pk, user_id uuid references users(id) null, school_id uuid references schools(id) null,
  provider text check in ('paddle','bank_alfalah'),
  provider_subscription_id text,
  plan text check in ('free','pro','school'),
  status text check in ('active','past_due','canceled','trialing'),
  country_code text, currency text, tier_id uuid references pricing_tiers(id),
  billing_period text check in ('monthly','yearly'),
  current_period_end timestamptz,
  created_at, updated_at
)

payment_events (
  id uuid pk, provider text, provider_event_id text unique, -- unique = idempotency guard
  subscription_id uuid references subscriptions(id),
  event_type text, amount_minor_units bigint, currency text,
  raw_payload jsonb,  -- provider payload minus any card/PII fields
  received_at, processed_at
)

pricing_tiers (
  id uuid pk, name text, currency text,
  pro_monthly_minor bigint, pro_yearly_minor bigint, school_per_seat_yearly_minor bigint,
  monthly_enabled bool default true, yearly_enabled bool default true,
  updated_at, updated_by uuid references users(id)
)

country_tier_map (
  country_code text primary key, tier_id uuid references pricing_tiers(id),
  updated_at, updated_by uuid references users(id)
)

-- Usage / entitlement enforcement (see NFR-SEC-07)
-- period_start semantics changed 2026-09-24 (Addendum 2): weekly (every Monday
-- 00:00 UTC), was monthly — column/table unchanged, only what `period_start`
-- represents changes. See FR-BILLING-06.
usage_counters (
  user_id uuid references users(id), period_start date,
  sheets_scanned int default 0,
  primary key (user_id, period_start)
)

-- Account lifecycle / reminders (non-sensitive, account-level only — see ADR-0005 addendum)
-- added to `users`: recovery_key_issued_at, recovery_key_reminder_7d_sent_at,
-- recovery_key_reminder_30d_sent_at, recovery_key_reminder_dismissed_at (all nullable timestamptz)

-- Result-card / public-announcement branding (Addendum 2, FR-ANALYTICS-05, FR-PUBLISH-06)
-- added to `users`: branding jsonb null -- {schoolName, logoUrl, colorTheme}, non-sensitive,
-- configured once per account, applied to every report card / announcement that account produces.
-- Per-account (not automatically unified across a school's teachers) per the founder's literal
-- "applied to every result card from THAT account" wording -- flagged as a possible later
-- enhancement (shared school-wide branding) rather than assumed now.

-- Misc admin-configurable operational parameters that don't fit pricing_tiers or feature_flags'
-- on/off shape -- e.g. STRAI ID expiry window (FR-PUBLISH-05), public-lookup rate-limit/CAPTCHA
-- thresholds (NFR-SEC-14). New table rather than overloading feature_flags, since these are
-- values, not flags, and this list will likely grow.
app_config (
  key text primary key, value jsonb, description text,
  updated_at, updated_by uuid references users(id)
)
-- seeded: ('public_result_ttl_days', '30', 'STRAI ID expiry window, FR-PUBLISH-05')
-- seeded: ('entitlement_cache_max_age_hours', '24', 'Client entitlement-cache freshness window, ADR-0015')
-- seeded (Addendum 4): ('capacity_warn_cpu_pct' / '_ram_pct' / '_disk_pct', '75',
-- 'Capacity-dashboard sustained-usage warning threshold, FR-ADMIN-16') -- reuses
-- this table rather than a parallel config mechanism, same pattern M5-014's
-- quota override already follows for usage_counters.
-- seeded (Addendum 5): ('last_security_review_date' / '_report_url', null,
-- 'Date + link of the last full pre-launch security-review pass, FR-ADMIN-17')
-- -- the one genuinely manual field the Security/QA dashboard shows; everything
-- else on that dashboard (CI check status, Dependabot alerts) is read live from
-- GitHub's own API, not stored here -- see the note below capacity_metrics_snapshots.

-- Capacity/scaling monitoring (Addendum 4, FR-ADMIN-16) -- periodic snapshots a
-- lightweight scheduled job writes (the same in-process scheduler pattern
-- already established for the Recovery Key reminder cadence, see §12/ADR-0011
-- -- no new job-queue infra). cpu_pct/ram_pct/disk_pct come from a lightweight
-- local read (e.g. /proc, `docker stats`), not a full Prometheus/node_exporter
-- stack -- proportionate to a single-VPS solo-founder deployment (see §12).
-- db_size_bytes from Postgres's own pg_database_size(); active_user_count/
-- scans_processed_count from existing users/server-side sync-call activity,
-- not new client instrumentation. The admin dashboard (M5-016) reads this
-- table directly; no separate time-series DB.
capacity_metrics_snapshots (
  id uuid pk, captured_at timestamptz not null,
  active_user_count int, new_user_count_since_last int,
  scans_processed_count int,  -- since the previous snapshot, not cumulative
  db_size_bytes bigint,
  cpu_pct numeric, ram_pct numeric, disk_pct numeric
)

-- Security/QA dashboard (Addendum 5, FR-ADMIN-17): deliberately holds no table
-- of its own beyond the one app_config field above. CI check-run status (incl.
-- the M0-013 secret-scanning job) and Dependabot alert state are read live from
-- GitHub's own API at render time -- both are already GitHub-native signals this
-- repo already produces, so mirroring them into a Sharlo-owned table would just
-- be a second, driftable copy of a fact GitHub already tracks authoritatively.
-- The GitHub token this needs is one more row in integration_credentials
-- (ADR-0017) -- the exact same encrypted-credential mechanism as every other
-- external integration, not a new storage pattern.

-- Non-sensitive templates
templates (
  id uuid pk, owner_id uuid references users(id) null, -- null = Sharlo stock template
  name text, question_count int, geometry jsonb, -- corner markers + bubble grid, no student data
  is_stock bool default false, schema_version int default 1,
  created_at, updated_at
)

-- Admin
feature_flags ( key text primary key, description text, rules jsonb, updated_at, updated_by )
admin_audit_log (
  id bigserial pk, admin_user_id uuid references users(id),
  action_type text, target_type text, target_id text,
  metadata jsonb, ip_address inet, created_at
)

-- Time-limited account suspension (Addendum 3, FR-ADMIN-03) -- added to `users`:
-- suspended_until timestamptz null. NULL = not suspended. A background check
-- (same lightweight scheduler class as the Recovery Key reminder job, ADR-0011)
-- or a plain "is now() < suspended_until" check at auth time lifts it automatically
-- at expiry -- no separate "unsuspend" admin action required.

-- Per-user scan-quota override (Addendum 3, FR-ADMIN-14) -- added to `users`:
-- quota_override_sheets int null, quota_override_expires_at timestamptz null.
-- NULL override = no override, standard FR-BILLING-06 weekly cap applies.
-- Read alongside `usage_counters` at the same enforcement point, not a parallel
-- limit system.

-- Integration credentials (Addendum 3, FR-ADMIN-15, ADR-0017) -- encrypted at
-- rest, decrypted only in-memory server-side at point of use, write-only from
-- the admin UI's perspective (never returned in decrypted form once saved).
-- Every provider adapter (Resend, Paddle, Bank Alfalah, the AI provider below)
-- reads its credential(s) from here, never from a hardcoded env var.
integration_credentials (
  id uuid pk, provider text not null, -- 'resend' | 'paddle' | 'bank_alfalah' | 'ai_support'
  key_name text not null, -- e.g. 'api_key', 'webhook_secret' -- a provider may need more than one
  encrypted_value bytea not null, -- AES-256-GCM under a server-held envelope key
  updated_at, updated_by uuid references users(id),
  unique (provider, key_name)
)

-- Support inbox + AI-drafted replies (Addendum 3, FR-ADMIN-10/12, ADR-0016) --
-- ordinary plaintext tables, NOT held to NFR-SEC-02's client-side-encryption
-- standard: this is the founder's own support-operations data (has to be
-- human-readable to be useful), not student data. The privacy-sensitive
-- boundary this feature actually protects is the outbound call to the AI
-- provider (NFR-SEC-15's sanitization pass), not storage here -- see ADR-0016.
support_tickets (
  id uuid pk, requester_email text not null, subject text,
  status text check in ('open','resolved'), created_at, updated_at
)
support_messages (
  id uuid pk, ticket_id uuid references support_tickets(id),
  sender_type text check in ('customer','admin','ai_draft'),
  body text not null,
  sent_at timestamptz null, -- null for an ai_draft not yet reviewed/sent -- see ADR-0016 invariant
  created_at
)
-- Founder-authored, generic-product-information-only (ADR-0016 decision 2) --
-- never populated from or referencing any individual user's/student's data.
support_kb_articles (
  id uuid pk, title text not null, body text not null,
  updated_at, updated_by uuid references users(id)
)

-- Financial ledger (Addendum 3, FR-ADMIN-13) -- extends the existing
-- `payment_events`/`subscriptions` billing data (§10) with the
-- founder-facing record-keeping views/tables it doesn't yet cover.
-- Cash-basis, consistent with §10's existing MRR/revenue-dashboard note --
-- not a new accrual-accounting system.
refunds (
  id uuid pk, payment_event_id uuid references payment_events(id),
  amount_minor_units bigint not null, currency text not null,
  reason text not null, is_chargeback bool not null default false,
  created_at, created_by uuid references users(id)
)
expenses (
  id uuid pk, description text not null, amount_minor_units bigint not null,
  currency text not null, category text, incurred_on date not null,
  created_at, created_by uuid references users(id)
)
-- Paddle payout summary and the separate Bank Alfalah/Pakistan ledger are
-- both derived views over `payment_events` (already carries provider +
-- amount + currency + timestamps) rather than new source-of-truth tables --
-- kept as two distinct report views specifically because Paddle payouts and
-- direct PKR settlements have different tax/reporting treatment, not because
-- the underlying data needs duplicating.

-- Addendum 2, FR-PUBLISH-* — the ONE deliberate exception to "no student data
-- lives here." Full design, why it's safe, and why it's the only one: §7a.
public_results (
  id uuid pk,
  strai_id text unique not null, -- the capability token itself; see ADR-0012 for entropy/encoding
  owner_user_id uuid references users(id), -- for account-deletion cascade (FR-PUBLISH-09), never used for lookup
  student_name text not null, roll_number text not null, marks jsonb not null, grade text,
  -- exactly the FR-PUBLISH-01 field set. No phone numbers, no other roster fields, ever.
  expires_at timestamptz not null, -- from app_config.public_result_ttl_days at creation time
  created_at timestamptz not null default now()
)
```

Notably **absent:** any table for exams, exam results, student names, roll numbers, or answer keys — except the one explicit, narrow exception above. That data has no reason to exist on our servers at all — see §7 and §7a.

---

## 7. Where exam/result data actually lives

Every exam, answer key, roster, and result set is a single JSON document with this envelope:

```json
{
  "schemaVersion": 1,
  "type": "examResults", // or "examKey", "roster", "template" (custom),
  // "class", "attendance" (Addendum 2, FR-ATTEND-*)
  "recordId": "‹random uuid, non-identifying›",
  "iv": "‹base64›",
  "ciphertext": "‹base64, AES-256-GCM over the actual content›",
  "authTag": "‹base64›"
}
```

- **Drive mode:** this JSON is written directly from the browser to the teacher's Google Drive via the Drive API, using the `drive.file` scope and the teacher's own OAuth access token. The backend is never in this request path — it doesn't proxy, doesn't see the payload, doesn't even get a webhook about it. Drive's own `appProperties` (unencrypted key/value metadata Drive allows per file, scoped to files our app created) is used to tag `type` and `recordId` so the app can list/find its own files via the Drive API without needing our backend to track file pointers at all.
- **Local-only mode:** the same JSON envelope is written to IndexedDB instead of Drive. "Export backup file" downloads the raw envelope(s); "Import backup file" restores them — this also doubles as the cross-device migration path for local-only users. Implemented in `M3-005` (`apps/web/lib/storage/local-envelope-store.ts` + `backup.ts`, `docs/reports/SHARLO-M3-005.md`) as a dumb, content-agnostic store keyed by `recordId` — it never decrypts or interprets a payload, only persists/lists/deletes it, the same way Drive's own `appProperties` tagging lets the app find its files without decrypting. **The illustrative `iv`/`ciphertext`/`authTag` split above is exactly that — illustrative, not yet reconciled against real code:** `apps/web/lib/crypto/aes-gcm.ts`'s actual, already-tested `aesGcmEncrypt`/`aesGcmDecrypt` (`M3-003`) produce/expect a single combined blob (`iv || ciphertext+authTag`), not three separate fields. Nothing has written a real envelope yet to force resolving this either way — whichever task first does (`M3-006` onward) should reconcile it against the real primitive, not this illustration.

This is why the "servers can't read student data" property is structural rather than a promise: the plaintext never has a reason to touch a server-controlled system, encrypted or not. There is no decrypt endpoint to forget to lock down, because there is no endpoint at all — with the one narrow, explicit exception in §7a.

**Envelope granularity, clarified for Addendum 2 (not a new design, a clarification an existing ambiguity needed once `FR-EXAMCFG-03`'s void-question recalc depended on it):** one `examResults` file = one exam, containing _all_ students' results for that exam as an array within it — not one file per student. Void/partial-credit recalculation (`FR-EXAMCFG-03`) is a single read-recompute-write of that one file, not N round-trips for a class of N. `attendance` follows the same reasoning at a different grain: one file per class _per month_ (not per day), so a monthly report (`FR-ATTEND-04`) is one Drive read, not ~30.

---

## 7a. The one exception: Public Result Announcement (Addendum 2, `FR-PUBLISH-*`)

**Read this before touching any code near `FR-PUBLISH-*`.** Everything above this section, and everywhere else in this document, is built around one property: our backend never receives plaintext student data. This feature is a deliberate, narrow, opt-in exception to that property — not a loophole, not a slow erosion of it, a single explicit carve-out with its own table (§6's `public_results`), its own access model (below), and its own limits (auto-expiry, minimal fields, `NFR-SEC-13`/`14`). Nothing else in the product works this way, and nothing else should without going back to the founder the way this one did (`docs/reports/SHARLO-M0-009.md`).

**Why it has to work this way:** every other feature's "reader" is the teacher, who's authenticated and holds the decryption key. A public result check is read by a student who has neither — no account, no key, nothing but a STRAI ID their teacher gave them. There's no cryptographic trick that lets an unauthenticated stranger decrypt a teacher-encrypted blob; the only honest options were (a) don't build this feature, or (b) let the teacher explicitly, per-exam, opt into publishing a minimal plaintext subset for exactly this purpose. The founder chose (b) — `FR-PUBLISH-01`'s "explicit, opt-in, per-exam" framing is the whole safety model, not a nice-to-have detail.

**Access model — capability token, not tenant RLS:** `public_results` has no `user_id`-based Postgres RLS policy in the sense §8 describes for everything else, because there's no authenticated "current user" for this endpoint at all — the requester is anonymous. Instead, the STRAI ID **is** the access credential (the same pattern as an unguessable share-link): possession of a valid STRAI ID plus the matching roll number is the only thing that authorizes reading one row. This holds up only because of `NFR-SEC-13`'s entropy requirement — the token has to be as unguessable as a real credential, because it's functioning as one. The lookup path is deliberately the _only_ code path that ever queries this table (one function, `(straiId, rollNumber) → one row or nothing`), so there's no other query surface to accidentally get a `WHERE` clause wrong on.

**What's still true here, just enforced differently:**

- _Fails closed:_ an invalid STRAI ID, a non-matching roll number, and an expired STRAI ID (`FR-PUBLISH-05`) all return the identical generic "not found" (`FR-PUBLISH-03`) — never distinguishable, so a wrong guess never tells an attacker which half was wrong.
- _Minimum necessary data:_ exactly four fields (`FR-PUBLISH-01`), enforced by the publish payload's own type, not just a description of intent.
- _Time-limited:_ every row has an `expires_at`; nothing published sits here indefinitely (`app_config.public_result_ttl_days`).
- _Deletable:_ cascades on the owning teacher's account deletion (`FR-PUBLISH-09`) — the one place in the system where "delete all my data" has to reach into a table that isn't tenant-RLS-scoped the normal way, called out explicitly so it doesn't get missed.
- _Rate-limited and CAPTCHA'd_ (`NFR-SEC-14`) — the STRAI ID is unguessable, but the roll-number half of the pair is not (small integer space), so the defense against "attacker has a valid STRAI ID and brute-forces roll numbers" is rate limiting, not entropy.

See `ADR-0012` for the full alternatives-considered writeup, including the narrower aggregates-only option that was on the table and not chosen.

---

## 8. Multi-tenant isolation

Because student _content_ never reaches Postgres, the isolation surface there is smaller than a typical multi-tenant SaaS — but not zero, and NFR-SEC-01 applies without exception to what remains: accounts, subscriptions, usage counters, templates, audit logs.

- Every tenant-scoped table carries an owning `user_id` or `school_id`.
- **Postgres Row-Level Security (RLS)** policies enforce `user_id = current_setting('app.current_user_id')` (or the equivalent school-scoped check) on every tenant table, set per-request by the API layer after authenticating the session. This is defense-in-depth on top of the application-layer query scoping — a bug in a handler's `WHERE` clause still can't cross tenants, because the database itself refuses.
- The Fastify app role connects to Postgres with a restricted database role that has **no** `BYPASSRLS` privilege.
- `admin_audit_log` has no `DELETE`/`UPDATE` grant to the application role at all — even a compromised app-layer session can't tamper with history, only a migration run under a separate privileged role could.
- **`public_results` is explicitly not part of this pattern** — there's no authenticated tenant on the read path to scope by (§7a). Its isolation is the STRAI ID acting as a capability token, not `user_id`-based RLS. Don't add a `user_id = current_setting(...)` policy to it expecting it to behave like the tables above; it can't, because the requester making the read is never one of our authenticated users.

---

## 9. Auth & session design

- Google OAuth 2.0, redirect flow with PKCE (not popup — popups are unreliable on iOS Safari, per the kickoff prompt).
- On successful OAuth callback, the API issues a signed, httpOnly, `SameSite=Lax` session cookie; the session record lives in a Postgres `sessions` table (not Redis — unnecessary infra at this scale; noted as a future optimization only if session-store load ever becomes a bottleneck).
- CSRF protection via the `SameSite` cookie policy plus a double-submit token on state-changing requests.
- The OAuth scope request is exactly `openid email profile` + `drive.file` — nothing broader. Per NFR-SEC-03, CI includes an automated check on the OAuth config that fails the build if this scope list changes without an explicit, reviewed diff acknowledging it.
- **Implemented in `M3-001`/`M3-002` (`docs/reports/SHARLO-M3-001.md`):** the code exchange happens server-side (a confidential client, real `client_secret`), so the token exchange calls Google's REST endpoints directly (`fetch`, no OAuth client library) rather than a public-client/browser-only flow. `access_type=offline` + `prompt=consent` are requested so Google issues a refresh token, stored encrypted on `users` (§6) — needed later by `M3-006`'s browser-direct Drive writes (the browser needs its own Google access token for that; obtaining/refreshing one from the stored refresh token is `M3-006`'s own endpoint to build, not part of this auth flow itself). Google's `userinfo` endpoint is called with the access token rather than verifying the ID token's JWT signature locally — one fewer place to get crypto wrong, at the cost of one extra HTTP round-trip Google already expects.
- **RLS's usual `app.current_user_id` claim doesn't work for every lookup a session-based auth flow needs**, and this is worth understanding before touching this code: validating a session (raw cookie token → which user is this?) and checking whether a Google account already has one (`google_sub` → existing user, at first-sign-in time) both have to run _before_ any user id — and therefore any tenant context — exists to scope the query with. Both are solved the same way: a second, purpose-specific Postgres session GUC (`app.session_lookup_token` for `sessions`, `app.google_sub_lookup` for `users`) set immediately before the one query that needs it, with an RLS policy scoped against that GUC instead of `current_user_id`. `M3-005`/ADR-0018 reuses the identical pattern twice more for the email-OTP sign-in path, which has the same shape one layer earlier (proving an email before any session exists): `app.email_lookup` for `users`, `app.otp_email_lookup` for `email_otp_codes` (§6). This preserves RLS's actual value (even a buggy, unscoped query can only ever see the one matching row, never the whole table) for lookups that are structurally "prove who you are" rather than "given I already know who I am." See `apps/api/src/db/client.ts` and `docs/reports/SHARLO-M3-001.md`'s Flags section for the full story of how the gap this closes was found.
- **Implemented in `M3-003` (`docs/reports/SHARLO-M3-003.md`, ADR-0005):** `apps/web/lib/crypto/` is where the actual master-key generation and wrapping happen — `argon2id.ts` (Argon2id KDF via `libsodium-wrappers-sumo`, MODERATE cost tier, chosen against `docs/SRS.md` NFR-PERF-01's reference-device RAM figure), `aes-gcm.ts` (native WebCrypto AES-256-GCM, no third-party library), `recovery-key.ts`, and `master-key.ts` (orchestration: setup, unwrap-by-passphrase, unwrap-by-recovery-key, re-wrap-on-passphrase-change). The API (`apps/api/src/routes/encryption.ts`, session-authenticated via a new `requireSession` helper in `request-session.ts`) only ever stores/returns the resulting ciphertext, salt, and KDF-params — it never receives a passphrase, a Recovery Key, or a master key, matching §5's "never receives... master keys or wrapping keys" boundary literally, not just in spirit. `GET /account/encryption-params`, `POST /account/encryption-setup` (one-time — rejects a second call so a race or bug can't silently orphan previously-wrapped data), `POST /account/encryption-passphrase` (re-wraps only the passphrase path, per FR-AUTH-07). The OAuth callback (§9 above) redirects to `/settings` unconditionally now — the only authenticated page that exists yet — which self-determines setup-vs-change-passphrase mode from the GET endpoint rather than the callback needing to know.
- **Implemented in `M3-004` (`docs/reports/SHARLO-M3-004.md`, ADR-0005 addendum, ADR-0011):** the Recovery Key reminder cadence. `apps/api/src/scheduler/recovery-key-reminders.ts` runs against the _privileged/owner_ DB connection (never the RLS-scoped `app_user` one — this is a genuinely cross-tenant sweep, the same category as a migration), sends exactly one 7-day and one 30-day reminder per Recovery Key issuance via the `EmailSender` interface (`apps/api/src/email/`), and stops entirely once the teacher actively re-confirms (`rotateRecoveryKey`, `POST /account/recovery-key-reminder-confirm`) — which issues a _brand-new_ Recovery Key rather than re-displaying the original, since the raw original is never retained anywhere (true zero-knowledge design). `ResendEmailSender` is real, wired-in code (§10-style provider-adapter pattern) that will throw until `M0-008` provisions a real Resend account — every caller treats that as an expected, retried-tomorrow failure, not a crash. `apps/web/app/(app)/layout.tsx` is the `(app)` route group's first shared layout, deliberately minimal (just the reminder banner, no nav/header shell) — every authenticated page shows the banner via `GET /account/recovery-key-reminder-status`, not just `/settings`.
- **Implemented in `M3-005` (`docs/reports/SHARLO-M3-005.md`, `ADR-0018`):** email + OTP authentication for local-only accounts (no Google identity). `users.auth_provider` (`'google' | 'email_otp'`) is deliberately a separate column from `auth_mode` — `auth_mode` is about _where student data lives_ (this §'s own boundary), `auth_provider` is about _how the account authenticates_; today the two are 1:1 but keeping them separate is what lets a future "local-only account links Google/Drive" flow become an account-_linking_ operation later rather than a schema change (ADR-0018's "Future: account linking"). `apps/api/src/auth/email-otp.ts`: `requestEmailOtp` mints a 6-digit code (hashed at rest, `email_otp_codes` above), emails it via the same `EmailSender` interface `M3-004` built, and deliberately never touches `users` — whether an email has an account must stay invisible to the caller (no enumeration signal). `verifyEmailOtp` checks the code against its hash/expiry(10 min)/attempt-cap(5), and only on success finds-or-creates the `users` row and calls the _exact same_ `createSession` the Google OAuth callback (§9 above) calls — a session carries no memory of which provider created it, so every downstream consumer (billing, entitlements, RLS, `M3-003`'s encryption routes) needs zero provider-specific branching. An email already registered under a different provider gets a `wrong_provider` refusal, never a silent link or duplicate. Both `POST /auth/email-otp/{request,verify}` are rate-limited (`@fastify/rate-limit`, `NFR-SEC-04` — 5 req/15 min and 10 req/15 min respectively), registered with `global: false` so this doesn't retroactively rate-limit every other existing route (a full API-wide pass is separate `M7` hardening work). `GET /account/me` (`apps/api/src/routes/account.ts`) exposes `authMode` to the client — needed by the local-only warning banner and settings backup card below, both of which must render correctly whether or not encryption setup has completed. `/signin` (`apps/web/app/signin/`) is the product's first real sign-in page — "Continue with Google" (a real cross-origin link) or this email+OTP flow, both ending at `/settings`, the same landing spot either way.

---

## 10. Payments architecture

Two providers, one internal model. See ADR-0006.

```ts
interface PaymentProviderAdapter {
  createCheckout(input: { userId; plan; billingPeriod; seats? }): Promise<{ redirectUrl }>;
  handleWebhook(rawRequest): Promise<NormalizedPaymentEvent>; // verifies signature internally
  refund(subscriptionId, amount?): Promise<void>;
  cancel(subscriptionId): Promise<void>;
}
```

- `PaddleAdapter` implements this against Paddle's Billing API (handles global tax/VAT as MoR, localized pricing/currency presentment, subscription lifecycle webhooks).
- `BankAlfalahAdapter` implements the same interface against Bank Alfalah's gateway for PKR-only checkout, with its own webhook/callback verification.
- Every webhook handler verifies the provider's signature before trusting any payload (NFR-SEC-11), and writes a `payment_events` row keyed by the provider's event ID so replayed/duplicate webhooks are idempotent no-ops.
- Both adapters normalize into the same `subscriptions`/entitlement shape, so every other part of the app (plan checks, feature flags, the admin panel) is provider-agnostic. A third provider (Easypaisa/JazzCash, later) is a third adapter, not a redesign — this satisfies FR-BILLING-05 concretely rather than by assertion.
- Country tier for Paddle customers comes from Paddle's reported billing/card country at checkout and on each renewal webhook (FR-BILLING-03) — never from request IP.

**Finance/analyst note:** yearly subscriptions are cash received today for service delivered over 12 months. For v1, the admin revenue dashboard shows cash-basis MRR/revenue (simplest, matches what Paddle/Bank Alfalah payouts actually look like) with gross vs. net-of-processor-fees both visible; proper ratable deferred-revenue recognition (accrual-basis, GAAP-style) is called out as a deliberate v1 simplification in `docs/TASKS.md` M5, worth revisiting once a bookkeeper/accountant is in the loop rather than something to over-build into the admin panel now.

**Addendum 3 (`FR-ADMIN-13`):** a failed-renewal webhook event (already ingested into `payment_events` per NFR-SEC-11) is surfaced as a dunning-list row — customers whose payment failed, for founder follow-up — rather than only silently updating `subscriptions.status` to `past_due`. Refunds gain an explicit `reason` field (`refunds`, §6) distinguishing a voluntary refund from a chargeback, since those are reported very differently for tax/accounting purposes. Both stay cash-basis, consistent with the note above — this is record-keeping richness, not a new accounting model.

---

## 11. Admin panel — structural guarantee, not a policy

Separate Next.js deployment target on its own subdomain (e.g. `admin.sharlo.app`), talking to the same Fastify backend but through admin-only, separately authorized routes.

Why admins structurally cannot see student data (FR-ADMIN-11):

1. The admin panel's entire data surface is the Postgres schema in §6. It has no Drive API credentials for any teacher, no code path that requests one, and no UI that could display one.
2. The only per-teacher secret-shaped values reachable from admin routes are the wrapped-master-key ciphertexts — and there is no "unwrap" operation implemented anywhere in the backend, for anyone, including support/admin tooling. Building one would be a deliberate, reviewable, visible code change, not a flag flip.
3. Error/crash logging (FR-ADMIN-08) runs through a scrubbing layer before anything is persisted or shipped to a log viewer — request bodies for any endpoint that could plausibly carry client-side-encrypted blobs are excluded from logs by default (allow-list, not block-list, so a new endpoint is unlogged-by-default until explicitly reviewed).

Also required:

- 2FA (TOTP) or passkey login, enforced server-side (no client-only gate).
- `robots.txt`/meta-robots `noindex, nofollow` on the entire subdomain.
- Every mutating admin action server-side authorized against the acting admin's role and written to `admin_audit_log` (§6, §8).

**Addendum 3 additions (support inbox/AI drafting, finance ledger, credentials store) don't weaken this guarantee.** All of their data (`support_tickets`, `support_messages`, `support_kb_articles`, `refunds`, `expenses`, `integration_credentials`) is operational/founder-facing, not student data — none of it is Drive content, a master key, or a wrapping key, so the structural argument in point 1 above still holds without modification. `integration_credentials` (`ADR-0017`) is the one table here holding real secrets; it's encrypted at rest and write-only from the admin UI specifically so a compromised admin session can rotate credentials but not read a currently-stored one back in the clear.

**Recommended hardening beyond the kickoff spec's baseline [DECISION NEEDED, non-blocking]:** for a solo-founder-operated admin panel, a single compromised admin credential is a big deal (refunds, plan changes, feature flags all in one place). Recommend adding a network-layer restriction in front of the 2FA login — e.g., Cloudflare Access with email-OTP, rather than a strict IP allowlist (which is painful while traveling). Cheap to add, meaningfully raises the bar beyond password+2FA alone. Flagged as an M7 task, not required for the admin panel to function.

---

## 12. Infrastructure & hosting

**VPS: Hetzner** (as suggested in the kickoff prompt), starting on a CPX21/CPX31-class instance — plenty of headroom for NFR-SCALE-02, upgradeable vertically before any horizontal-scaling work is justified. See ADR-0009.

- **Reverse proxy / TLS: Caddy** — automatic HTTPS with minimal config, a good fit for solo-maintained infra versus hand-rolling Nginx + certbot.
- **Orchestration:** Docker Compose (Postgres, Fastify API, Caddy) — no Kubernetes; not justified at this scale and would cost more solo-founder time than it saves.
- **Postgres:** self-hosted in the same Compose stack initially (per the kickoff prompt's "self-hosted API + PostgreSQL"), with nightly `pg_dump` backups shipped to S3-compatible object storage (Hetzner Object Storage or Backblaze B2) plus periodic Hetzner volume snapshots. Managed Postgres is a reasonable later upgrade if backup/ops burden grows — not needed to start.
- **Object storage:** S3-compatible bucket for non-sensitive template geometry/assets only (§6).
- **Transactional email: Resend.** Needed for the Recovery Key reminder cadence (ADR-0005 addendum) and later School-invite/billing-notice emails. See ADR-0011 (including its Addendum 3 guardrails: never self-hosted SMTP, never multi-account sending rotation, role inboxes via a free-tier hosted provider). Requires DKIM/SPF/DMARC setup on the sending domain as an M0 infra task, and a lightweight scheduled-job mechanism (in-process daily scheduler is sufficient at this scale — no job-queue infra needed yet) to drive the 7-day/30-day reminder checks.
- **AI provider (Addendum 3, `ADR-0016`):** a pluggable, provider-agnostic dependency for support-reply drafting only — never in a core product/data-processing path (that remains `ADR-0014`'s "no AI" boundary). Configured via `integration_credentials` (`ADR-0017`), not an env var.
- **Distribution: PWA only, confirmed** (CLAUDE.md non-negotiable — no native app). The only recurring hosting cost is the domain; this VPS already hosts web/API/DB, no separate app-store hosting infrastructure. See `docs/TASKS.md` Backlog `BACKLOG-002` for the post-revenue, non-blocking Trusted Web Activity (Play Store) wrapper — same PWA, no separate codebase, no Apple App Store listing (unfavorable review policy for thin PWA wrappers; Safari's "Add to Home Screen" already covers iOS adequately).
- **Domains:** marketing + app on the apex/`app.` subdomain via the main Next.js deployment; admin on its own subdomain (§11) — ideally a genuinely separate deploy target so a marketing-site bug can't accidentally expose admin routes.
- **CI/CD:** GitHub Actions runs `npm run ci` (lint + typecheck + test) on every push/PR; a separate deploy workflow (SSH + `docker compose pull && up -d`, or a small container registry push/pull) runs on merge to `main`. No blue/green or k8s-style rollout needed at this scale — brief downtime on deploy is acceptable for v1 and should be explicitly, not silently, accepted.
- **Capacity monitoring (Addendum 4, `FR-ADMIN-16`):** VPS-level CPU/RAM/disk read via a lightweight local mechanism (e.g. periodic `/proc` reads, or `docker stats --no-stream` since everything already runs in this Compose stack) — not a full Prometheus/node_exporter/Grafana stack, which would be disproportionate infra for one VPS with no fleet to aggregate across. Written into `capacity_metrics_snapshots` (§6) by the same in-process scheduler already driving the Recovery Key reminder cadence, read directly by the admin dashboard. Revisit this choice (a real metrics stack) only if/when there's an actual fleet to monitor, not preemptively.
- **DNS: Cloudflare (free plan), proxied.** Nameservers point at Cloudflare rather than the registrar's own DNS panel — free DDoS/WAF protection layered on top of plain DNS, no extra recurring cost. Full record list (A/MX/SPF/DKIM/DMARC) and the proxied-vs-DNS-only reasoning per hostname live in `infra/README.md`'s "DNS (Cloudflare)" section, not duplicated here — that file is what a founder actually configuring DNS reads step by step.
- **Security headers, CORS, error pages (Addendum 5, `NFR-SEC-17`):** security response headers (CSP/HSTS/X-Frame-Options) belong at the Caddy layer (one shared config point in front of both `web` and `api`, rather than duplicated per-app); CORS restriction belongs at the Fastify layer (`@fastify/cors` or equivalent, an explicit origin allowlist, never a wildcard); custom error pages replace Next.js's/Fastify's own default error output in production so a raw stack trace is never the thing a user sees. All three are configuration on infrastructure that already exists (Caddy, Fastify) — no new service.
- **Secret scanning: gitleaks in CI (Addendum 5, `M0-013`, `NFR-SEC-18`).** Runs on every push/PR (`.github/workflows/ci.yml`), not a pre-launch-only pass — the free, open-source scanner, chosen deliberately over relying on GitHub's own native secret scanning, which requires a paid GitHub Advanced Security plan for a private repository.

---

## 13. Threat model

| Threat                                                                                              | Target                                                                                            | Mitigation                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant data read (IDOR-style)                                                                 | Another teacher's/school's Postgres rows                                                          | RLS policies (§8) as a hard backstop under app-layer scoping; every query path tested for tenant-scoping.                                                                                                                                                                                                                          |
| Server compromise / DB dump                                                                         | Student PII                                                                                       | Structurally absent from Postgres — an attacker who dumps the DB gets ciphertext blobs (wrapped keys) and account metadata, never student content. This is the single biggest payoff of the §7 design.                                                                                                                             |
| Admin panel compromise (stolen admin credential)                                                    | Full user/billing control, no student data (see §11)                                              | 2FA/passkey, audit log, recommended network-layer hardening (§11), least-privilege DB role for the app.                                                                                                                                                                                                                            |
| Payment webhook spoofing                                                                            | Fraudulent plan upgrades / fake refunds                                                           | Signature verification on every webhook (NFR-SEC-11), idempotency via `provider_event_id`.                                                                                                                                                                                                                                         |
| OAuth token theft (XSS or device compromise)                                                        | Teacher's Drive files created by our app                                                          | `drive.file` scope limits blast radius to app-created files only, never the teacher's whole Drive; session cookies httpOnly to resist XSS token theft; short-lived access tokens, refreshed via Google's normal OAuth refresh flow.                                                                                                |
| XSS in the results table (student names rendered back into the UI)                                  | Session/token theft, UI manipulation                                                              | React's default escaping + CSP headers; no `dangerouslySetInnerHTML` on any student-data-derived field.                                                                                                                                                                                                                            |
| CSV/formula injection on export                                                                     | Whoever opens the exported file in Excel/Sheets                                                   | Cell-value sanitization for leading `= + - @` (NFR-SEC-06) — an easy-to-miss class explicitly called out in the SRS.                                                                                                                                                                                                               |
| Free-tier quota bypass via client tampering                                                         | Revenue (minor)                                                                                   | Accepted risk, soft enforcement (NFR-SEC-07) — not worth DRM-style engineering at this price point; monitored via anomaly patterns (e.g., heavy usage with zero counter syncs) rather than prevented outright.                                                                                                                     |
| Malicious/oversized image upload (custom template photo, batch scanner import)                      | Availability, storage abuse                                                                       | Client-side size/type validation for UX; backend-side limits on anything that does transit the server (template geometry payloads, not images themselves — see §6, images for custom templates are processed to geometry client-side and only the derived geometry may be persisted); rate limiting on all endpoints (NFR-SEC-04). |
| Forgotten Encryption Passphrase + lost Recovery Key                                                 | Permanent, unrecoverable data loss for that teacher (by design of true zero-knowledge encryption) | Explicit, unmissable UX warning at Recovery Key issuance (FR-AUTH-08); this is a real product-support-burden risk worth the founder's awareness, not just an engineering footnote — flagged again in the M0 report.                                                                                                                |
| Supply-chain (compromised npm dependency)                                                           | Full app compromise                                                                               | Pinned versions + lockfile committed (required by kickoff prompt), automated dependency vulnerability scanning in CI (NFR-SEC-10).                                                                                                                                                                                                 |
| Google OAuth app verification lapse/rejection                                                       | Auth flow breaks for all users                                                                    | Verification prep (privacy policy, domain ownership, branding, demo video) tracked as an explicit, launch-blocking M3 task, not an afterthought.                                                                                                                                                                                   |
| STRAI ID brute-force / enumeration (Addendum 2)                                                     | A published exam's student results                                                                | 128-bit-plus entropy (NFR-SEC-13) makes the ID itself infeasible to guess; rate limiting + CAPTCHA (NFR-SEC-14) bound the roll-number-guessing side of the attack even _with_ a valid ID; generic not-found responses (§7a) prevent using error differences to narrow the search.                                                  |
| STRAI ID leak via referrer/logs/screenshot (it's a bearer credential by design)                     | Same as above, for exactly that one exam's published results, never more                          | Blast radius is deliberately capped: one STRAI ID exposes one exam's minimal published fields, nothing else, and expires automatically (`app_config.public_result_ttl_days`) — the exception's narrowness (§7a) _is_ the mitigation here, not a separate control.                                                                  |
| Public-results endpoint used to enumerate valid vs. invalid STRAI IDs at scale (availability/recon) | Confirming which announcements exist                                                              | Same rate limiting/CAPTCHA as above (NFR-SEC-14) — this is the standard mitigation for a capability-token design, not a gap specific to this feature.                                                                                                                                                                              |

---

## 14. Versioned data model

- Every Postgres table that holds structured records carries a `schema_version` where relevant, and all schema changes go through tracked Drizzle migrations (no manual schema edits against prod).
- Every encrypted Drive/local JSON envelope (§7) carries `schemaVersion` in its unencrypted wrapper, so a future app version can detect and migrate older records (re-decrypt under the old shape, re-encrypt under the new one) without guessing.

---

## 15. Architecture decisions — resolution log

(Full context lives in `docs/reports/SHARLO-M0-001.md`, `docs/reports/SHARLO-M0-007.md`, and `docs/reports/SHARLO-M0-009.md`; summarized here for architectural completeness. This section used to be phrased as open questions — all but two are now resolved.)

1. **§9 / ADR-0005 — RESOLVED.** Encryption Passphrase confirmed as the resolution to the "password-derived wrap key" requirement. Founder additionally required the proactive Recovery Key reminder cadence now in the ADR-0005 addendum, which is what pulled transactional email (ADR-0011) into the architecture.
2. **§6, §7, §10, ADR-0010 — RESOLVED.** School-plan dual-encryption confirmed, with school-key copies stored in a Drive location the _school admin_ owns (Shared Drive preferred, folder fallback) rather than in individual teachers' Drives, for institutional-continuity reasons. Full access-grant mechanism (Google Picker requirement, teacher-removal handling) documented in the ADR.
3. **§7, FR-SCAN-06 — DEFERRED TO BACKLOG.** Offline-first scanning approved as a concept but explicitly not in v1 scope; do not build against it until it's pulled off the backlog into a milestone.
4. **§11 — STILL OPEN, non-blocking.** Recommended network-layer hardening on the admin subdomain beyond the spec's 2FA baseline has not been explicitly confirmed or declined. Tracked as task M7-007; revisit when M7 is reached.
5. **Gulf PPP pricing — RESOLVED, confirmed 2026-09-24.** Seed table now in `docs/SRS.md` §5.9a.
6. **§6, §7a, ADR-0012 (Public Result Announcement) — RESOLVED, confirmed 2026-09-24 (Addendum 2), including the storage/access-model design.** The one deliberate exception to the zero-server-plaintext architecture; full design in §7a.
7. **`docs/SRS.md` NFR-SEC-12 (Free-tier gating given the client-side architecture) — RESOLVED, confirmed.** Server-sourced entitlement as source of truth, real rejection wherever a server endpoint genuinely exists; founder explicitly declined moving computation server-side to get stronger enforcement (the privacy model, `ADR-0001`, isn't a trade-off target). Founder added one refinement: the entitlement fetch caches locally with a bounded freshness window (~24h default) and tolerates offline use, re-validating on reconnect rather than requiring a live round-trip per check — full design in `ADR-0015`, written specifically so `BACKLOG-001` (offline-first scanning) has this already figured out whenever it's built.
8. **M1 sign-off + real-device validation gate — RESOLVED, confirmed 2026-09-25 (Addendum 3).** `docs/reports/SHARLO-M1-010.md`'s three flagged judgment calls (synthetic generator fixtures, detection-engine scope narrowing, the synthetic-vs-real-world accuracy disclosure) all approved as-is. New task `M1-011` (real-device pilot against real printed/hand-filled/scanned sheets) added to close the real-world half of `NFR-ACC-01`–`04` — does not block M2 or any later milestone, but does block `M7-011` (launch sign-off); see `docs/TASKS.md` M1/M7.
9. **AI-assisted support reply drafting (`FR-ADMIN-12`) — RESOLVED, confirmed 2026-09-25 (Addendum 3), `ADR-0016`.** A new, separately-approved AI use case, explicitly distinct from and not in conflict with `ADR-0014`'s "no AI on student data" boundary — support-ticket drafting only, never auto-sent, mandatory PII-sanitization pass before any third-party API call (`NFR-SEC-15`).
10. **Admin-managed integration credentials — RESOLVED, confirmed 2026-09-25 (Addendum 3), `ADR-0017`.** Every integration secret (Resend, Paddle, Bank Alfalah, the new AI provider) moves to an encrypted, admin-panel-writable store, never a plaintext env var. Ships in two stages: the table + minimal write path pulled forward into `M0-010` (needed immediately by `M0-008`), the polished admin UI in `M5-012`.
11. **Admin-panel finance/ops scope (`FR-ADMIN-13`/`14`/`15`) — RESOLVED, confirmed 2026-09-25 (Addendum 3).** Financial ledger (dunning, payout/PKR ledger split, refund reasons, expenses, net profit), per-user quota override, and the credentials panel above all folded into the existing M5 (Admin Panel) milestone rather than a new parallel milestone — reasoning in `docs/reports/SHARLO-M0-011.md`: all three are admin-panel-shaped work that already needs M5-001/002's subdomain/auth/audit-log infrastructure, and splitting them into a separate milestone would fragment one cohesive area for no dependency-graph benefit.
12. **Capacity/scaling dashboard (`FR-ADMIN-16`) and synthetic load testing (`M7-006`) — RESOLVED, confirmed 2026-09-25 (Addendum 4).** Same reasoning as item 11: the capacity dashboard is admin-panel-shaped work that already needs M5's subdomain/auth/audit-log infrastructure, so it folds into M5 as `M5-016` rather than a new milestone (there is no separate "M-Ops" milestone in `docs/TASKS.md` — admin-panel ops/finance work has consistently landed in M5 since item 11, and this follows the same pattern). Its data flow is deliberately lightweight (§6/§12: a periodic snapshot table + the existing in-process scheduler, no new metrics-stack infra) — proportionate to a single-VPS deployment, revisit only once there's an actual fleet to justify more. Load testing was already `M7-006`; Addendum 4 concretizes it (tool choice left to the implementer — k6 or Artillery, both free/open-source; 1,000/5,000/10,000/20,000 simulated concurrent users; server-touching surfaces only — auth, API, DB, webhooks, never scanning) rather than adding a parallel task, and adds a firm deliverable: a new ADR documenting the real measured findings and the resulting VPS-tier/scaling-plan recommendation, not just a report. Per the founder's own framing, `M7-006` does not need to wait for the rest of M7 — see `docs/TASKS.md`'s M7 section for the explicit "run as soon as M3–M5's core surfaces are stable" note, the same pattern `M1-011` already established for a task that lives in one milestone's list but isn't gated on the rest of it.
13. **DNS/Cloudflare, the pre-launch security & QA program, and the admin Security/QA dashboard (`FR-ADMIN-17`) — RESOLVED, confirmed 2026-09-26 (Addendum 5).** DNS moves to Cloudflare's free plan (proxied for every hostname, including the admin subdomain and the webhook-receiving API domain — see `infra/README.md`'s new "DNS (Cloudflare)" section for the full record list and the Paddle-webhook caveat this environment's restricted network access couldn't independently re-verify). The security/QA program is split three ways rather than one bulk addition: `M0-013` (gitleaks secret-scanning in CI) implemented immediately, the same day, the same reasoning as `M0-004`'s Dependabot — continuous protection shouldn't wait for a milestone; five new M7 tasks (`M7-012`–`016`: SAST/OWASP/dependency-audit sweep, multi-tenant isolation pentest, custom error pages + security headers, OWASP ZAP + SSL Labs scan against staging, manual QA pass on staging) plus small expansions to `M7-001`/`002`/`006` for items already close enough to an existing task's scope that a parallel task would just duplicate it (backup-restore verification was already exactly `M7-008`; webhook signature verification was already `NFR-SEC-11`/`M4-003` — both confirmed as already covered, not silently missed); and the dashboard itself as `M5-017`, folded into M5 for the identical reason item 11/12 already give. The checklist's "passwords hashed with bcrypt/Argon2" item doesn't apply here by design, not by oversight — Google OAuth means no password is ever stored server-side, and the Encryption Passphrase is designed to never leave the client (`ADR-0001`) — noted explicitly in `M7-012`'s own task description so a future implementer doesn't go looking for a hashing gap that was never supposed to exist.

14. **`users`' own RLS policy would have blocked the app's restricted connection from ever creating a new user — RESOLVED, found and fixed 2026-09-26 (`M3-001`/`M3-002`).** Not an addendum item — a real implementation-time gap in `M0-006`'s original RLS design, never exercised because that task's own proof only ever read fixture rows seeded through the privileged connection, never inserted a new one through the restricted `app_user` role RLS actually governs. First-time Google sign-in needs exactly that: insert a brand-new `users` row, and separately, look one up by `google_sub` before any user id (and therefore any `current_user_id` tenant claim) exists to scope the query with. Fixed with the same tool RLS already uses elsewhere, extended to two more purpose-specific GUCs (`app.google_sub_lookup` on `users`, `app.session_lookup_token` on the new `sessions` table, §9 above) rather than a special-cased exception — `docs/reports/SHARLO-M3-001.md` has the full account.
15. **Master key generation & wrapping — RESOLVED, shipped 2026-09-26 (`M3-003`, ADR-0005).** `users`' `wrapped_master_key_by_passphrase`/`wrapped_master_key_by_recovery`/`kdf_salt`/`kdf_params`/`recovery_key_verifier`/`recovery_key_issued_at` columns (provisioned ahead of time during `M3-001`) needed no new migration — only the client-side crypto (`apps/web/lib/crypto/`) and the session-authenticated API routes to persist/retrieve them. All three unwrap paths (passphrase, Recovery-Key-alone, and the passphrase-change re-wrap that leaves prior data untouched) and the negative path (wrong credential fails via AES-GCM's own authenticated-decryption rejection, never a partial/corrupted result) are directly tested, not assumed — see §9 above and `docs/reports/SHARLO-M3-003.md` for the full account, including the Argon2id cost-tier reasoning and the M3-004 Recovery-Key-rotation handoff.
16. **Recovery Key reminder cadence — RESOLVED, shipped 2026-09-26 (`M3-004`, ADR-0005 addendum, ADR-0011).** Split per the founder's own instruction: the onboarding-UX half (forced confirmation, download, unmissable messaging) landed in `M3-003` since `M3-003`'s own signup flow needed it to be real; this task is the reminder-cadence half (scheduler, banner, Resend integration behind a swappable `EmailSender` interface, wired in but not yet exercised end-to-end pending `M0-008`). A real bug was caught and fixed during this task's own test-writing, not by inspection: the Recovery-Key-rotation confirm handler was initially passing the _entire_ rotation-result object — including the raw plaintext Recovery Key display string — through to the endpoint that persists it, which would have sent the actual key to the server over the network, a direct violation of the zero-knowledge design this whole subsystem exists to uphold. A `toHaveBeenCalledWith` exact-shape assertion in the component test caught the extra field immediately; fixed by constructing an explicit, narrow object literal at the call site instead of forwarding the wider one. See `docs/reports/SHARLO-M3-004.md` for the full account.
17. **Local-only mode's missing auth mechanism — RESOLVED, confirmed 2026-09-26 (`M3-005`, new `ADR-0018`).** A genuine gap found and correctly stopped on rather than guessed through, per this project's own stop-conditions: every account mechanism built through `M3-004` is Google-OAuth-specific, and `FR-AUTH-06` (local-only mode) has no identity provider to authenticate a local-only signup against at all. Founder decision: passwordless email + OTP, a new `users.auth_provider` column kept deliberately separate from `auth_mode` (§9 above has the full reasoning), and session issuance that converges on the exact same `createSession` the Google OAuth callback already uses — no provider-specific branching anywhere downstream. `M3-005`'s remaining scope (IndexedDB storage, warning banner, backup, sign-in UI) shipped as a second part of the same task — see item 18 below. See `docs/reports/SHARLO-M3-005.md`.
18. **`M3-005`'s local-only product feature — DONE, shipped 2026-09-26, same task as item 17 above.** `apps/web/lib/storage/local-envelope-store.ts`/`backup.ts` (IndexedDB storage + export/import, §7), the local-only warning banner (deliberately non-dismissible, unlike the Recovery Key one — §9), the `/settings` Backup card (available from the first session, not gated on encryption setup), and `/signin` — the product's first real sign-in page, replacing the marketing page's placeholder. Found and flagged, not silently resolved: `ARCHITECTURE.md` §7's illustrative envelope JSON (`iv`/`ciphertext`/`authTag` as three fields) doesn't match the real, already-tested `aes-gcm.ts` primitives (one combined blob) — nothing has written a real envelope yet to force reconciling this, left as a flagged note for whichever task does (`M3-006` onward), not guessed at here. See `docs/reports/SHARLO-M3-005.md`.

Items 1–3 no longer block any M3 work. Individual-teacher M3 tasks were never blocked; School-plan-specific M3 tasks (M3-014 onward) are now unblocked per `docs/TASKS.md`. Items 5–7 unblock the corresponding parts of M4 and the new M8–M12. Items 8–13 are Addendum 3/4/5's additions, all resolved on arrival — nothing from this round is open. Items 14–18 are real implementation-time findings/deliverables from `M3-001`–`M3-005`, not addenda items. The one item that remains open project-wide is the admin-subdomain network-layer hardening recommendation (§11 of this document, task `M7-007`), tracked separately in `docs/SRS.md` §8 since it predates this list and isn't part of any addendum's decisions.

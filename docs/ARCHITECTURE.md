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
  auth_mode text check in ('google','local_only'),
  account_type text check in ('teacher','school_admin','platform_admin'),
  school_id uuid null references schools(id),
  wrapped_master_key_by_passphrase bytea,   -- ciphertext only
  wrapped_master_key_by_recovery bytea,      -- ciphertext only
  kdf_salt bytea, kdf_params jsonb,           -- Argon2id params, not a secret
  recovery_key_verifier bytea,                 -- verifier hash, not the key itself
  schema_version int not null default 1,
  created_at, updated_at
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
- **Local-only mode:** the same JSON envelope is written to IndexedDB instead of Drive. "Export backup file" downloads the raw envelope(s); "Import backup file" restores them — this also doubles as the cross-device migration path for local-only users.

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

**Recommended hardening beyond the kickoff spec's baseline [DECISION NEEDED, non-blocking]:** for a solo-founder-operated admin panel, a single compromised admin credential is a big deal (refunds, plan changes, feature flags all in one place). Recommend adding a network-layer restriction in front of the 2FA login — e.g., Cloudflare Access with email-OTP, rather than a strict IP allowlist (which is painful while traveling). Cheap to add, meaningfully raises the bar beyond password+2FA alone. Flagged as an M7 task, not required for the admin panel to function.

---

## 12. Infrastructure & hosting

**VPS: Hetzner** (as suggested in the kickoff prompt), starting on a CPX21/CPX31-class instance — plenty of headroom for NFR-SCALE-02, upgradeable vertically before any horizontal-scaling work is justified. See ADR-0009.

- **Reverse proxy / TLS: Caddy** — automatic HTTPS with minimal config, a good fit for solo-maintained infra versus hand-rolling Nginx + certbot.
- **Orchestration:** Docker Compose (Postgres, Fastify API, Caddy) — no Kubernetes; not justified at this scale and would cost more solo-founder time than it saves.
- **Postgres:** self-hosted in the same Compose stack initially (per the kickoff prompt's "self-hosted API + PostgreSQL"), with nightly `pg_dump` backups shipped to S3-compatible object storage (Hetzner Object Storage or Backblaze B2) plus periodic Hetzner volume snapshots. Managed Postgres is a reasonable later upgrade if backup/ops burden grows — not needed to start.
- **Object storage:** S3-compatible bucket for non-sensitive template geometry/assets only (§6).
- **Transactional email: Resend.** Needed for the Recovery Key reminder cadence (ADR-0005 addendum) and later School-invite/billing-notice emails. See ADR-0011. Requires DKIM/SPF/DMARC setup on the sending domain as an M0 infra task, and a lightweight scheduled-job mechanism (in-process daily scheduler is sufficient at this scale — no job-queue infra needed yet) to drive the 7-day/30-day reminder checks.
- **Domains:** marketing + app on the apex/`app.` subdomain via the main Next.js deployment; admin on its own subdomain (§11) — ideally a genuinely separate deploy target so a marketing-site bug can't accidentally expose admin routes.
- **CI/CD:** GitHub Actions runs `npm run ci` (lint + typecheck + test) on every push/PR; a separate deploy workflow (SSH + `docker compose pull && up -d`, or a small container registry push/pull) runs on merge to `main`. No blue/green or k8s-style rollout needed at this scale — brief downtime on deploy is acceptable for v1 and should be explicitly, not silently, accepted.

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

Items 1–3 no longer block any M3 work. Individual-teacher M3 tasks were never blocked; School-plan-specific M3 tasks (M3-014 onward) are now unblocked per `docs/TASKS.md`. Items 5–7 unblock the corresponding parts of M4 and the new M8–M12. Nothing in this numbered list is still open as of this round — the one item that remains open project-wide is the admin-subdomain network-layer hardening recommendation (§11 of this document, task `M7-007`), tracked separately in `docs/SRS.md` §8 since it predates this list and isn't part of Addendum 1 or 2's decisions.

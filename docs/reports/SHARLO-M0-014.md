# Report: SHARLO-M0-014 — Incorporate Addendum 5 (DNS/Cloudflare runbook, pre-launch security & QA program, admin Security/QA dashboard)

**Status: done, this session** (pending final CI verification before merge — see "Current status").

---

## 🚩 Flags — read this section first

### 1. Paddle's (and Bank Alfalah's) live webhook documentation could not be independently re-verified — network egress is blocked

The addendum explicitly asks: "check Paddle's requirements specifically before deciding" on proxied-vs-DNS-only mode for the webhook-receiving API domain. I attempted this — `WebFetch` against `developer.paddle.com` (and, separately, a plain reachability check against `www.google.com` to rule out a Paddle-specific block) both returned `EGRESS_BLOCKED`. This environment enforces a domain allowlist for outbound HTTPS that neither host is on, so there is no tool-call path from inside this session to Paddle's actual current documentation.

I did not paper over this. `infra/README.md`'s new "DNS (Cloudflare)" section states plainly that the "proxied everywhere, including the webhook-receiving API domain" recommendation is a well-reasoned default (Cloudflare-proxied webhook endpoints are an extremely common, well-supported pattern — Stripe, GitHub, and most SaaS webhook senders work fine behind one) rather than an independently re-verified fact, and names the real verification point: `M4-003` (the Paddle adapter task), where a real sandbox webhook either arrives or doesn't. If it doesn't, the documented fallback is a five-minute DNS change (proxied → DNS-only), not a redesign. Bank Alfalah gets the identical treatment for the identical reason — it's a local Pakistani bank gateway with no widely-reachable public API documentation to check even without the network restriction.

**If a future session has broader network access than this one, it's worth spending five minutes confirming this against Paddle's actual current docs before `M4-003` — but M4-003's real sandbox test is the authoritative check either way, so this isn't blocking.**

### 2. `M5-017` (Security & QA dashboard) folds into M5 — same reuse of the M0-011/M5-016 precedent, not a fresh decision

Same reasoning as `M5-016` (capacity dashboard, Addendum 4) and the finance/ops tasks before it (Addendum 3): this is admin-panel-shaped work that needs M5-001/002's subdomain/auth/audit-log infrastructure regardless, so a separate milestone would fragment one cohesive area for no dependency-graph benefit. Flagging the reuse explicitly rather than presenting it as a fresh judgment call each time.

### 3. Two checklist items were already covered by existing tasks/requirements — confirmed, not re-added

The addendum's own instruction was explicit ("coordinate so they aren't duplicated") for dynamic/fuzz testing against `M7-006`, which I folded in. Two other checklist items turned out to be **already fully covered** by existing scope, not merely overlapping:

- **"A backup restore test, not just a backup existence check"** — this is verbatim what `M7-008`'s existing done-when criterion already says ("A backup is actually restored to a scratch environment and verified readable, not just 'backups exist.'"). No change made beyond cross-referencing it from the new `NFR-SEC-19`.
- **"Paddle webhook signature verification... cryptographically verified"** — already `NFR-SEC-11` (existing requirement) and already part of `M4-003`'s scope (the Paddle adapter task). No change made beyond confirming this in this report so a future session doesn't independently re-add it believing it was missed.

### 4. The bcrypt/Argon2 checklist item: architectural note captured verbatim, embedded where an implementer will actually see it

The addendum's own instruction was to "note this explicitly in the security review report." Since `M7-012` (the SAST/OWASP/dependency-audit task) is the one that will actually produce that review report, and won't be executed for a long time yet, I embedded the note directly in `M7-012`'s own task description in `docs/TASKS.md` (not only in this report, which a future implementing session may not read) — Google OAuth means no password is ever stored server-side, and the Encryption Passphrase (`ADR-0005`) is designed to never leave the client, so there is no server-side password hash to manage for either credential. `M7-012`'s done-when criterion explicitly requires the eventual review report to state this non-applicability rather than silently omit that checklist line, so the discipline carries forward to whoever actually executes that task.

### 5. gitleaks implemented immediately, not deferred to `M7`'s pre-launch pass — mirrors the `M0-004`/Dependabot precedent

The addendum lists secret-scanning as one line item in a larger pre-launch checklist, but "on every push going forward, not just once at launch" is the addendum's own explicit phrasing — a one-time pre-launch scan would miss every commit between now and then. `M0-004` (Dependabot) already established the precedent that continuous protection shouldn't wait for a milestone gate, so gitleaks was implemented now, as its own task ID (`M0-013`), rather than folded into the pre-launch-only `M7-012`. GitHub's own native secret scanning was considered and rejected — it requires a paid GitHub Advanced Security plan for a private repository, whereas gitleaks (MIT-licensed) is free regardless of repo visibility.

**This is genuinely unverified until real CI runs**: `gitleaks/gitleaks-action@v2`'s behavior in this repo's actual CI environment (rate limits, licensing gates for private repos, action-version pinning) has not been exercised yet. The remaining steps in this task (below) include watching the real GitHub check-run data for this specific job before treating `M0-013` as actually done, per the standing CI rule — not just assuming a correctly-written YAML file works.

### 6. Found and fixed a latent `.gitignore` inconsistency while verifying the addendum's own checklist item

The addendum's checklist includes "confirm `.gitignore` correctly excludes env files." While checking this, I found `apps/web/.gitignore`'s `.env*` pattern lacked the `!.env.example` exception that the root `.gitignore` already has — meaning `apps/web/.env.example`, if one is ever added, would be silently gitignored rather than committed. No live file was actually affected (no `apps/web/.env.example` exists yet), but this is exactly the kind of latent gotcha this checklist item exists to catch, so I fixed it rather than only reporting it.

### 7. Whether Addendum 5's security/QA program fully satisfies Addendum 4's "dedicated security deep-dive" flag is noted, not assumed

Addendum 4 (Section 5) flagged that the founder wants a dedicated security deep-dive before deployment/testing, explicit that `M7-001` alone doesn't satisfy it, and explicit that it wasn't yet scoped or scheduled. Addendum 5 now delivers a large, concrete security/QA program (`M7-012`–`016`) that looks, in substance, like exactly that deep-dive. But the founder never explicitly said "this is that deep-dive" — so rather than silently closing out the Addendum 4 flag, I updated the `CLAUDE.md` bullet to note the likely connection while leaving it open for founder confirmation. If a future session reads this and the founder has since confirmed (or denied) the connection, update that `CLAUDE.md` bullet accordingly.

---

## What was built

Governance/docs work, plus one real CI/workflow change. No application code touched.

- **`.github/workflows/ci.yml`**: new `secret-scanning` job (`gitleaks/gitleaks-action@v2`), full-history checkout (`fetch-depth: 0` — gitleaks scans commit history, not just the working tree, so a secret committed and later deleted is still caught).
- **`apps/web/.gitignore`**: added the missing `!.env.example` exception (consistency fix, Flag 6).
- **`infra/README.md`**: expanded "Prerequisites"; new "DNS (Cloudflare)" section — A-records table (all three hostnames proxied/orange-cloud, with reasoning including keeping `M7-007`'s Cloudflare Access option open), and an "Email records (Resend + Zoho)" subsection (MX/SPF/DKIM/DMARC, with the single-combined-SPF-record warning); updated the admin-subdomain bullet under "What this does not yet cover" to note its DNS record can be created now.
- **`docs/SRS.md`**: `NFR-SEC-17` (security headers/CORS/clean error pages, Observatory-verified), `NFR-SEC-18` (continuous CI secret-scanning), `NFR-SEC-19` (pre-launch adversarial verification pass: multi-tenant pentest + real backup-restore test) added after `NFR-SEC-16`; `FR-ADMIN-17` (Security/QA status dashboard) added after `FR-ADMIN-16`.
- **`docs/ARCHITECTURE.md`**: §6 gains an `app_config` seeded-keys comment for the last-review date/link plus a design note explaining the Security/QA dashboard reads GitHub's API live rather than duplicating a stored table; §12 gains three bullets (DNS/Cloudflare, security headers/CORS/error pages, gitleaks); §15 gains resolution-log item 13 and an updated closing paragraph.
- **`docs/TASKS.md`**: `M7-011`'s row updated to reference the new tasks; five new rows (`M7-012`–`016`) inserted after it; a standalone post-table note covering `M7-006` and `M7-012`–`016` collectively, each with its own specific readiness dependency; `M7-002` and `M7-006` rows expanded in place (CORS/login-signup-reset rate limiting; dynamic/fuzz testing); `M5-017` inserted after `M5-016`; `M0-013` and `M0-014` inserted after `M0-011` in the M0 table.
- **`CLAUDE.md`**: the Addendum-4 "security deep-dive" bullet extended with the Addendum 5 cross-reference (Flag 7); four new bullets (gitleaks live in CI; bcrypt/Argon2 non-applicability; `M7-012`–`016` launch-blocking status; DNS/Cloudflare summary + `infra/README.md` pointer).

## Key decisions

Covered in full in the Flags section above (M5-017 placement reuse, already-covered confirmations for `M7-008`/`NFR-SEC-11`, gitleaks-now vs. gitleaks-at-launch, the bcrypt/Argon2 note's placement, and the honest treatment of the network-egress limitation) — not repeated here.

One addition not flagged above because it's routine rather than a judgment call: `M7-013` (multi-tenant isolation pentest) is written as testing through the running API specifically, distinct from `M0-006`'s existing RLS database-level proof — the addendum's own framing ("not just trust that the RLS/isolation design is correct on paper") is what makes this a genuinely new test, not a duplicate of `M0-006`.

## Deviations from the addendum's original description

- The addendum offers "M7 — Launch Hardening... but your call" for Section 2/3 placement; I placed the bulk of it in `M7-012`–`016` as new tasks, but split out gitleaks into an immediate task (`M0-013`) rather than waiting — see Flag 5.
- The addendum asks to "check Paddle's requirements specifically before deciding" on DNS proxy mode; this could not be done due to network restrictions in this environment — see Flag 1.

## How this was tested

Docs-only change plus one CI workflow file — no test suite applies to the documentation content itself. Cross-references between new/changed IDs (`NFR-SEC-17`–`19`, `FR-ADMIN-17`, `M7-012`–`016`, `M5-017`, `M0-013`/`M0-014`) were checked by hand for consistency across all five touched files (`SRS.md`, `ARCHITECTURE.md`, `TASKS.md`, `CLAUDE.md`, `infra/README.md`) as they were written, and re-verified by direct re-read after a bash-quoting bug corrupted the first attempt at the `TASKS.md` M0-013/M0-014 rows (an inline `python3 -c "..."` with backticks inside a double-quoted string let bash interpret them as command substitution, stripping most inline-code references down to empty parens; caught immediately on re-reading the written file, fixed by rewriting the same rows via a script file instead of an inline `-c` string, then re-verified). `npm run ci` runs before pushing per the standing rule (see "Current status"); the `secret-scanning` CI job itself will only be genuinely verified once real GitHub Actions check-run data confirms it (see Flag 5) — not claimed as working before that.

## Current status

Documentation and CI-workflow changes complete in the working tree. Remaining before this task is actually "done" per this project's own standing rule ("a task is not done until CI is green on the pushed branch," confirmed via real check-run data, not memory): run `npm run ci` locally, commit, push, open a PR, watch CI to completion — with particular attention to whether the new `secret-scanning` job passes cleanly on its first real run — and merge only once every check is confirmed green.

Per the founder's explicit instruction, this does not block M3: M3-001 (Google OAuth PKCE redirect flow) begins immediately after this task's PR is merged and the branch is restarted.

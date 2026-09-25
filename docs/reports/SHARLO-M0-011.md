# Report: SHARLO-M0-011 — Incorporate Addendum 3 (M1 sign-off, real-device validation, operations & infrastructure)

**Status: done, this session.**

---

## 🚩 Flags — read this section first

Four things worth flagging explicitly, per the standing "flag, don't guess" rule — none blocking, all judgment calls made on the founder's explicit "your call, flag your reasoning" instruction.

### 1. `M1-011` (real-device validation) is not something a Claude Code session can execute independently

It requires a real printer, real pens/pencils, real hands to fill sheets a range of ways, a few real lighting setups, and at least one real Android and one real iPhone. Nothing in this sandbox can do any of that. I've added it to `docs/TASKS.md` as founder-executed or founder-coordinated (a delegate would work too), not something a future session should attempt to simulate or estimate its way through. If a future session is asked to "do M1-011," the correct response is to say so and ask how the founder wants to run it — not to fabricate numbers or substitute more synthetic-fixture work under the same task ID (that would defeat the entire point, which is specifically to measure what synthetic fixtures can't).

### 2. Operations/infrastructure additions folded into M5, not a new "M-Ops" milestone

The founder offered both options explicitly. I chose folding into M5 (Admin Panel) because sections 3b–3d of the addendum (AI-assisted support, finance dashboard/ledger, operational controls, no-code settings) are all, structurally, admin-panel features that need exactly the infrastructure M5-001/002 already establish (the admin subdomain, 2FA-gated auth, the audit log every mutating admin action writes to). Two of the four new-work areas are direct expansions of tasks that already existed in M5 before this addendum (`M5-007` revenue dashboard already had MRR/churn/revenue-by-country; `M5-010` already existed as a support/ticket view; `M5-003` already did block/refund/change-plan) — treating the richer versions as new tasks in a parallel milestone would have split one cohesive feature area's history across two milestone numbers for no dependency-graph benefit. Section 3a (email) and 3e (hosting/distribution confirmation) aren't admin-panel work at all, so they went where they actually belong: an addendum to the existing `ADR-0011` and `M0-008` (email), and a `Backlog` entry plus a confirming note in `ARCHITECTURE.md` §12 (hosting/distribution — this one needed no real change, see flag 4).

### 3. A real sequencing tension, resolved the way this codebase already resolves this exact kind of tension

The founder's no-code-settings requirement is unconditional: no integration credential (Resend included) is ever a plaintext env var. But `M0-008` (Resend setup) is meant to be early/foundational, while a polished credentials-management UI is naturally M5 (admin panel) work — M5 doesn't exist yet by the time M0-008 needs a place to put the Resend key. I resolved this the same way `M4-005` ("includes the client-side caching layer from the start... not a billing-page helper bolted on later") and `M3-008` ("build this as the reusable component... one component with this as its first call site") already resolve identical tensions in this codebase: pull the minimal, shared mechanism forward to where it's first needed (`M0-010`: the encrypted table + a bare write path), and let the later milestone build the polish on top of the same table (`M5-012`: the actual admin UI, rotation UX, audit-logged changes). `M0-008`'s description now points at `M0-010` explicitly.

### 4. Checked `ADR-0016` (new) against `ADR-0014` ("no AI/LLM-assisted data processing") before writing anything — no conflict, but worth stating why explicitly

`ADR-0014`'s own text anticipates this exact situation: "If a future, genuinely different use case seems to want AI/LLM assistance... that's explicitly a new decision requiring the same level of founder sign-off this one got." The founder's message is that sign-off. The two decisions don't overlap in scope: `ADR-0014` forbids AI touching **student data or exam content** (the import-matching case it was written for); `ADR-0016` (support-reply drafting) never touches either — its input is a support ticket plus a founder-maintained generic knowledge base, and critically, its output is **never applied automatically** — the founder reviews and explicitly sends, edits, or discards every draft, the same "AI suggests, a human confirms" shape the bubble Review Queue and import column-mapping already use elsewhere in this product. I wrote `ADR-0016` to state this distinction directly rather than silently adding an AI feature near an ADR whose title is literally "no AI," and added a `CLAUDE.md` decisions-log bullet so a future session doesn't have to rediscover this reasoning from scratch.

---

## What was built

Governance/docs work only — no application code touched.

- **`docs/TASKS.md`**: `M0-010` (integration credentials store, pulled forward) and `M0-011` (this task) added to M0; `M1-011` (real-device validation pilot) added to M1, with an explicit note that it gates `M7-011` but not M2; `M7-011` updated to name that dependency; `M5-003`/`M5-007`/`M5-010` descriptions expanded; `M5-012` (settings-panel UI), `M5-013` (AI-drafted replies), `M5-014` (quota override), `M5-015` (financial ledger) added; `BACKLOG-002` (TWA/Play Store wrapper) added.
- **`docs/SRS.md`**: `FR-ADMIN-03`/`07`/`10` descriptions expanded; `FR-ADMIN-12`–`15` added (AI-drafted replies, financial ledger, quota override, no-code settings panel); `NFR-SEC-15`/`16` added (mandatory pre-AI-call PII sanitization; encrypted-at-rest integration credentials).
- **`docs/ARCHITECTURE.md`**: §6 gains `integration_credentials`, `support_tickets`/`support_messages`/`support_kb_articles`, `refunds`, `expenses`, plus `users` columns for time-limited suspension and per-user quota override; §10 gains a dunning/refund-reason note; §11 gains a paragraph confirming the new admin data doesn't weaken the "admins can't decrypt student data" structural guarantee; §12 gains AI-provider and PWA-distribution-confirmation notes; §15's resolution log gains items 8–11 for this addendum's decisions.
- **`docs/ADR/0011-transactional-email-provider.md`**: addendum — no self-hosted SMTP, no multi-account sending rotation, role inboxes via a free-tier hosted provider, mandatory SPF/DKIM/DMARC, credentials via `ADR-0017` not env vars.
- **`docs/ADR/0016-ai-assisted-support-reply-drafting.md`** (new): the AI-support-drafting design, its relationship to `ADR-0014`, the draft-only invariant, and the mandatory sanitization pass.
- **`docs/ADR/0017-admin-managed-integration-credentials.md`** (new): the encrypted-at-rest, admin-writable, no-redeploy-to-rotate credential storage design used by every integration going forward.
- **`CLAUDE.md`**: fixed a stale "milestones M0–M7" reference (M8–M12 were added by Addendum 2 but this line was never updated — caught and fixed while here); added decisions-log bullets for M1's completion/M2 authorization, the `ADR-0014`-vs-`ADR-0016` distinction, and the new credential-storage rule.

## Key decisions

Covered in full in the Flags section above (milestone placement, the M0-010/M5-012 split, the ADR-0014 boundary check) — not repeated here to avoid saying the same thing twice. One additional decision not flagged above since it wasn't a judgment call so much as a design detail: `support_tickets`/`support_messages`/`support_kb_articles`/`refunds`/`expenses` are ordinary plaintext Postgres tables, not held to `NFR-SEC-02`'s client-side-encryption standard, because none of them are student data — they're the founder's own operational records, which have to be human-readable to be useful. The actual privacy-sensitive boundary `ADR-0016` protects is the outbound call to the AI provider (`NFR-SEC-15`'s sanitization pass), not storage. Stated explicitly in both the ADR and `ARCHITECTURE.md` §11 so a future reader doesn't over-encrypt ordinary support-ops data or, worse, assume the sanitization requirement is about storage when it's actually about the third-party API boundary.

## Deviations from the addendum's original description

- The addendum offered "M-Ops" as a name if a new milestone were created; none was — see Flag 2.
- `FR-ADMIN-07`'s existing scope (MRR/churn/revenue-by-country) was kept as the "dashboard" task and the newer ledger/dunning/expenses asks split into a separate `FR-ADMIN-13`/`M5-015`, rather than growing `FR-ADMIN-07`/`M5-007` to cover both — these are different UI surfaces (a glance-able dashboard vs. a records-keeping ledger) even though they share underlying data, and splitting them keeps each independently testable, matching this codebase's existing granularity (e.g., `M3-014`/`015`/`016` splitting School setup into tightly-scoped tasks rather than one large one).
- No new ADR was written for the hosting/distribution confirmation (addendum §3e) — `CLAUDE.md`'s existing "No native mobile app. Web/PWA only" non-negotiable already covers it with no contradiction found; only a `Backlog` entry (`BACKLOG-002`) and a short confirming note in `ARCHITECTURE.md` §12 were needed.

## How this was tested

Docs-only change — no test suite applies to the content itself. `npm run format` + `npm run ci` (format-check, lint, typecheck, test) run before pushing per the standing rule, to catch exactly the kind of Prettier-on-Markdown miss that broke `M1-003`'s report push earlier in this project. Cross-references between the new IDs (`FR-ADMIN-12`–`15`, `NFR-SEC-15`/`16`, `ADR-0016`/`0017`, `M0-010`/`011`, `M1-011`, `M5-012`–`015`, `BACKLOG-002`) were checked by hand for consistency across all six touched files (`TASKS.md`, `SRS.md`, `ARCHITECTURE.md`, `CLAUDE.md`, and the two new ADRs) as they were written, not just grepped after the fact.

## Current status

Done. All of Addendum 3's non-code requests (M1 sign-off acknowledgment, the real-device validation task, and the operations/infrastructure scope) are now reflected in the docs. Per the founder's explicit "go," M2 (Templates & Review Queue) starts next, in a separate task/report.

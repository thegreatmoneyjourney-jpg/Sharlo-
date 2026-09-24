# Report: SHARLO-M0-001 — Foundational planning docs

**Status: done.** SRS, Architecture, 10 ADRs, task breakdown, CLAUDE.md, README, and this report are written and pushed. **No feature code was written**, per the kickoff prompt's instruction to hold until you've reviewed the plan.

---

## 🚩 Flags — read this section first

Per the kickoff prompt's own rule ("do not silently drop, simplify, or defer... flag it and wait for confirmation"), here's everything that needed a judgment call, ranked by how much it matters.

### 1. The encryption key-wrapping spec contradicts the auth method (needs your decision before M3)

The spec says the master key is wrapped by "a key derived from the teacher's account password." But auth is Google Sign-In only — there is no Sharlo account password, by design (we never see one). That instruction literally can't be implemented as written.

**What I did:** proposed a fix in `docs/ADR/0005-client-side-encryption-key-management.md` — a separate **Encryption Passphrase**, distinct from the Google login, set once at signup. It's used locally (Argon2id) to derive the key that wraps the master key; it's never sent to us in a recoverable form. This is the same pattern Bitwarden and Proton use when they support SSO alongside end-to-end encryption, for the identical reason: an identity provider can prove who you are, but it can't hand your app secret entropy the server never sees.

**What this costs:** one more thing for a non-technical teacher to remember, beyond their Google login. I think it's the right tradeoff for the privacy claim to actually be true rather than aspirational, but it's a real UX cost you should sign off on, not something I should decide alone.

**Also flagging as a product risk, not just an engineering footnote:** if a teacher loses _both_ the Encryption Passphrase and the Recovery Key, their gradebook data is permanently gone — that's inherent to real zero-knowledge encryption, not a bug. Worth thinking about the support-ticket volume this could generate at scale (a teacher near the end of a term losing access to grades is a bad support conversation to have). I'd suggest strong onboarding UX around the Recovery Key now, and possibly a school-admin break-glass recovery path for teachers-under-a-school later (using the same school-key mechanism as flag #2 below) — not for individual teachers, since that would mean building a backdoor, which is exactly what this design is supposed to not have.

**Decision needed:** confirm the Encryption Passphrase approach, or tell me a different resolution you'd prefer.

### 2. "School-wide results dashboard" is cryptographically impossible under the spec as written (needs your decision before M3/M4 School-plan work — does not block M1/M2)

Two requirements in the spec conflict directly:

- Student data is encrypted only to the _individual teacher's_ key, stored in _that teacher's own_ Drive.
- The School plan needs a principal dashboard showing school-wide results.

If only the teacher's key can open the data, a principal has no way to see it — not "restricted by us," but actually impossible with the mechanism as specified. This gap isn't addressed anywhere in the source spec, so it's not something I could resolve by re-reading it more carefully.

**What I did:** designed a resolution in `docs/ADR/0010-school-plan-multi-recipient-encryption.md` — each School account gets its own key; when a teacher joins, their client also encrypts a second copy of results to that school key (in addition to their own, so their individual view is unaffected). The principal's browser decrypts the school-key copies to build the dashboard. Our backend still never decrypts anything — it just serves ciphertext to a different keyholder.

**Genuinely open sub-question I did _not_ resolve unilaterally:** _where do the school-key copies live?_ Option (a) stays inside each teacher's own Drive with the principal's client reading across every teacher's Drive (more consistent with "teacher's Drive is primary," but needs a real cross-account sharing/consent flow). Option (b) writes into a Drive location the school admin owns (simpler for the dashboard to read, but ties school data to the admin's own account and needs its own sharing-permission design). Both are workable; I don't think either is obviously right without knowing how you want the School product experience to feel, so I left it open in the ADR rather than picking one and building it.

**A narrower option worth considering too:** if you'd rather minimize what a principal can technically access, the school-key copy could carry only pre-computed aggregates (class averages, question difficulty) instead of full raw per-student results — smaller exposure surface, less flexible dashboard. Flagging this as a real alternative, not just a footnote.

**Decision needed:** confirm the dual-encryption approach, pick (a) or (b) for storage location (or tell me you want the narrower aggregates-only option instead), before M3-014 onward starts. Individual Free/Pro teacher functionality has zero dependency on this and is not blocked.

### 3. Recommended addition: offline-first scanning (low cost now, high cost to retrofit)

Not explicitly requested, but a classroom with weak Wi-Fi is a completely normal real-world condition, and since scanning is already 100% client-side with no per-scan server call, making the whole capture flow work with zero connectivity (queuing only the final Drive sync) is close to "free" to build in from the start and expensive to bolt on later. I added it as `FR-SCAN-06`/`NFR-REL-01` in the SRS and flagged it rather than silently assuming it. **Tell me if you'd rather I drop it** — it's the one addition here that's a genuine (small) scope increase, not just a clarification of something already implied.

### 4. A soft spot in free-tier enforcement, and why I'm not "fixing" it with more engineering

Because scanning has zero server involvement (by design, for cost and privacy), the 150-sheets/month free cap can only be enforced by the client voluntarily reporting a count. A determined user could block that one network call and scan past the cap. I designed for **soft enforcement** — optimistic local counting, reconciled when online, capped on next sync — rather than a hard per-scan server gate, because a hard gate would mean a server round-trip before every capture, which undercuts the offline-first goal and the "no per-scan server dependency" cost story for a relatively small amount of abuse risk at a $3–6/month price point. This is a deliberate, judgment-call tradeoff (documented in `docs/ARCHITECTURE.md` NFR-SEC-07) rather than an oversight — flagging it so it's a decision you're aware of, not a gap you discover later.

### 5. A couple of things worth your eyes, not action items right now

- **PPP tier placement:** UAE/Saudi/Qatar are seeded as Tier 1 per your spec. Worth a second look specifically at _teacher salaries_ in those markets (vs. general per-capita GDP, which is skewed by non-teacher industries) before launch pricing goes live — I didn't change your seed values, just flagging it since the admin panel makes this editable anyway and you'll want to sanity-check it once before publishing prices.
- **Admin panel hardening beyond spec baseline:** the spec asks for 2FA — reasonable baseline. For a solo-founder-operated panel that can issue refunds and flip feature flags, I'd recommend adding a cheap network-layer gate in front of it too (e.g., Cloudflare Access with email-OTP, not a strict IP allowlist since you'll travel) — detailed in `docs/ARCHITECTURE.md` §11 and tracked as task `M7-007`, non-blocking.

---

## What was built

Per kickoff prompt §9, all in `docs/` unless noted:

- `SRS.md` — full functional/non-functional requirements, user roles, data classification, numeric acceptance-criteria proposals for the scanning engine (flagged as targets to validate empirically in M1, not marketing claims), traceability to task IDs.
- `ARCHITECTURE.md` — system diagram, frontend structure, backend design (Fastify + Drizzle, justified), Postgres schema (deliberately minimal — no exam/result data lives there at all, see below), the encrypted-envelope design for Drive/local storage, multi-tenant isolation via Postgres RLS, auth/session design, payments architecture (provider-adapter pattern), admin-panel structural guarantees, Hetzner/Docker/Caddy infra plan, full threat model table, versioned data model.
- `ADR/0001`–`0010` — one record per major decision, including the two proposed resolutions to the contradictions in flags #1 and #2 above.
- `TASKS.md` — milestones M0 (added — repo/CI foundation, implied but not named in your milestone list) through M7, each task with an ID, linked requirement IDs, and a concrete "done when" — not just a title.
- `CLAUDE.md` — persistent instructions for future sessions: doc map, non-negotiables checklist, CI/retry rules, stop conditions, report format.
- `README.md` — rewritten with tech stack summary and doc links.
- `docs/reports/` — this file.

## Key decisions made (beyond the two flagged above)

- **Backend framework: Fastify + Drizzle ORM**, over NestJS (too much ceremony for this backend's deliberately small scope) and Prisma (heavier runtime; Drizzle composes more cleanly with hand-written Postgres RLS policies, which this project leans on hard). Full reasoning in ADR-0007.
- **Postgres holds _zero_ exam/result/roster/answer-key data — not even encrypted blobs or file pointers.** Everything content-related lives as an encrypted JSON envelope written browser-direct to Drive (or IndexedDB in local-only mode), tagged via Drive's own `appProperties` so the app can find its own files without our backend tracking anything. Postgres holds only accounts, wrapped-key ciphertext, subscriptions, usage counters, non-sensitive template geometry, and admin data. I went narrower here than the spec strictly required (it only said "servers can't read student data," not "servers can't know student data exists at all") because the narrower version is strictly safer, isn't harder to build, and makes the "structurally can't leak" claim stronger and easier to verify. Detailed in `ARCHITECTURE.md` §6–§7.
- **Exam titles are treated as sensitive** (encrypted, not stored server-side) even though they're not classic PII — a title like "Grade 5 Math Midterm, Lincoln Elementary" can itself be identifying, and there's no cost to treating it conservatively since the backend doesn't need it for anything.
- **CSV/formula-injection sanitization** on exports (`NFR-SEC-06`) — a real, frequently-missed vulnerability class (a roster cell like `=1+1` can execute as a formula when the exported file is opened in Excel/Sheets). Added explicitly since it's exactly the kind of thing that's easy to ship without noticing.
- **Finance/analyst note on the revenue dashboard:** proposed cash-basis MRR (gross and net-of-processor-fees, multi-currency-normalized) for v1's admin analytics, rather than full accrual-basis deferred-revenue recognition for yearly plans. The latter is the "more correct" accounting treatment but is real extra build for a v1 internal dashboard; flagged in `ARCHITECTURE.md` §10 as a deliberate simplification worth revisiting with a bookkeeper/accountant rather than something to silently skip forever.
- **Marketing/positioning note:** the architecture decisions in flags #1 and #4 and ADR-0001/0004 add up to a genuinely strong, _true_ claim worth leading with in marketing copy and the `llms.txt`: "your students' photos and data never leave your control — not even we can read them." That's rare in ed-tech and is a real differentiator, not just a privacy checkbox — worth building the homepage/positioning around rather than burying in a privacy policy. Didn't write marketing copy here since that's outside this task's scope, just flagging the angle.

## Deviations from the task description, and why

- Added milestone **M0** (repo/CI/VPS foundation) ahead of M1, since M1 can't start without a working repo/CI/deploy skeleton and the spec's milestone list started at M1 — this is infrastructure sequencing, not new product scope.
- Everything in the two 🚩 flags above is a deviation from a literal reading of the spec, in both cases because the literal spec was internally inconsistent, not because I preferred a different design. Both are held to "proposed" status pending your confirmation, and nothing downstream (M1/M2, most of M3) is blocked by leaving them open for now.

## How this was tested

This task produced documentation only — no code, so no automated tests apply. Self-review pass performed for internal consistency: every `FR-*`/`NFR-*` ID in `SRS.md` is referenced by at least one task in `TASKS.md`; every architectural claim in `ARCHITECTURE.md` that names a decision has a corresponding ADR; the two open decisions are consistently marked "needs confirmation" (not silently treated as final) across `SRS.md`, `ARCHITECTURE.md`, the relevant ADRs, `TASKS.md`, and `CLAUDE.md`.

## Current status

**Done**, pending your review. Per the kickoff prompt, no feature code will be written until you've had a chance to look at this and the SRS/TASKS breakdown — I'll wait for your go-ahead (or answers to the flags above) before starting M0-002 (Next.js scaffold) and the rest of M0.

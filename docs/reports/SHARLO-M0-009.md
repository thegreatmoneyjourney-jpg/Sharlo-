# Report: SHARLO-M0-009 — Addendum 2 scope (Sections 1–7) incorporated into SRS/ARCHITECTURE/TASKS + new ADRs

**Status: docs done, PR open for your review per your explicit instruction — not merged, and M1 not started. This is the "report back once the docs PR is up" this task asked for.**

---

## 🚩 Flags — read this section first

### 1. The "server-side enforcement" requirement can't literally apply to most of this addendum's features — resolved with a proposed boundary, needs your explicit confirmation

Your Section 2 instruction: "a Free-tier user directly calling an endpoint for a gated feature must be rejected server-side." That's fully achievable for the minority of new features that actually reach a server endpoint — template creation beyond quota, Public Result Announcement publishing, School seat management. It's **not achievable as literally stated** for the majority of this addendum (attendance, negative marking, multi-set/void-question scoring, every `FR-ANALYTICS` item, the import/editable-grid flow), because this product's foundational architecture (`ADR-0001`, confirmed at kickoff) computes all of that entirely client-side against Drive-stored data the server never sees. There is no endpoint to reject a call against, because there's no call.

**What I did:** proposed a resolution (`NFR-SEC-12`, `docs/SRS.md`) rather than either silently building something weaker than what you asked for, or silently reinterpreting your instruction without telling you. The resolution: for the minority with real endpoints, genuine server-side rejection, exactly as you described. For the majority without one, the _entitlement itself_ (which plan an account is on) is always server-sourced and re-fetched — never a client-cached or hardcoded flag — so a downgrade takes effect immediately without a new deploy, even though there's no per-action rejection to point to. A determined user could still tamper with client-side code to unlock a client-only feature that never touches our server — this is the same accepted risk as the existing scan-quota soft-enforcement (`NFR-SEC-07`), not a new or weaker standard invented for this addendum.

**This is genuinely the best available answer given the architecture you already approved, not a corner I'm cutting** — but it's also not what your instruction literally said, so I'm not treating it as settled the way the rest of this addendum is. Confirm `NFR-SEC-12`, or tell me you want something different (e.g., moving some of these computations server-side after all, which would be a real architecture change with its own cost/privacy tradeoffs I'd want to walk through before doing).

### 2. Four features got swept from "free" to "Pro/School" under the strict reading of "nothing else is on Free" — flagging each explicitly

Your Section 2 named the _new_ Pro/School features explicitly, but "nothing else described below, or anywhere else in the SRS, is available on Free" is absolute, and it catches a few things that predate this addendum:

1. **Custom templates** (`FR-TPL-02`) — kickoff originally gave Free "1 custom template." Now zero; custom templates are Pro/School only.
2. **Class analytics** (hardest questions, weak students, distribution — `FR-RESULTS-03`) — was unconditional, now Pro/School.
3. **Printable result cards**, the original simple version (`FR-RESULTS-05`) — was unconditional, now superseded entirely by the new branded report-card template (Pro/School). Free's export path is CSV/Excel only, no PDF/print.
4. **The other direction** — Review Needed queue and duplicate-sheet detection stayed on Free, treated as load-bearing parts of "scanning" itself (the core trust guarantee) rather than separate features nobody asked to keep. Flagged too, since it's the one place I _didn't_ apply the strictest reading.

Implemented as the stricter reading throughout `docs/SRS.md` §5.9a. Any of these four can be reverted with one word if the sweep caught something you didn't mean to include.

### 3. Gap I found and fixed while doing this: the actual seed pricing numbers were never in a tracked file

Going to apply your Gulf pricing confirmation, I found the literal Tier 1/2/3/Pakistan dollar amounts from the original kickoff prompt had never actually been written into any committed doc — only described conceptually (schema shape, FR-BILLING requirements). There was nothing to "update" until I added the full table first. It's now in `docs/SRS.md` §5.9a, seed values complete, Gulf tier included. Not a scope issue, just noting it so a future session doesn't wonder why this "update" looks like it added a whole table.

### 4. Public Result Announcement is a real, deliberate crack in "we never see your data" — designed as narrowly as I could, but it's a genuine exception, not a technicality

This is the one place in the whole architecture where our backend receives plaintext student data by design. There's no way around that — an anonymous student with no account and no key can't decrypt a teacher-encrypted blob, so a public checker either doesn't exist or the teacher explicitly hands over a minimal subset for exactly this purpose. Full design in `ADR-0012` and `ARCHITECTURE.md` §7a: exactly 4 fields, opt-in per exam, capability-token access (the STRAI ID _is_ the credential), auto-expiring, deleted on account deletion, generic fail-closed error responses, rate-limited. I also considered and rejected an encrypt-with-key-in-the-URL scheme that would let the "zero server-plaintext" claim technically survive — decided against it because it doesn't actually change the exposure (anyone with the link/QR still gets the data) and would make an honest exception look like a preserved guarantee, which is worse than an honestly-caveated one.

**Marketing/legal implication, flagging since it touches the "we can't read your data" claim I helped establish as a homepage angle earlier:** that claim needs one honest caveat from here on — _"...unless you explicitly publish specific results for student self-checking."_ Stated plainly wherever the broader claim appears, not buried in a privacy policy footnote. Added to `M7-009`'s scope (legal docs) so it doesn't get missed at launch.

### 5. Applied your confirmations exactly: Gulf pricing, ads

- **Gulf pricing:** applied as a new `pricing_tiers` row — Pro Monthly $3.99, Pro Yearly $39.99, School $12/teacher/yr (unchanged) — for UAE/Saudi/Qatar, moved out of Tier 1. Seed table: `docs/SRS.md` §5.9a.
- **Ads:** fully removed from scope, everywhere. `FR-ADMIN-06`, `M5-006`, `M7-010` all marked cancelled (kept as placeholder IDs, not deleted/renumbered, so nothing downstream shifts).

---

## What was built

**CLAUDE.md:** new standing rule — commit atomicity, verify every push actually landed (fetch + compare, not just "the command didn't error"), treat an indeterminate/cancelled/timed-out CI run as a failure, keep watching every push to completion.

**docs/SRS.md:** Free-tier scope hard-redefined (§5.9a's full feature-by-feature gating table, with the four narrowing flags above called out inline, not just in this report); quota changed 150/month → 100/week; ads removed; the actual seed pricing table (previously missing, see flag 3) added with the confirmed Gulf tier; five new FR sections (`FR-ATTEND`, `FR-EXAMCFG`, `FR-ANALYTICS`, `FR-IMPORT`, `FR-PUBLISH`) covering all of Sections 3–7, each requirement with an acceptance criterion, same rigor as the original SRS; four new NFRs (`NFR-SEC-12` through `15`) covering the entitlement-boundary resolution and STRAI-specific security (entropy, rate-limiting, generic errors); data classification table updated with the one new "deliberately public" row; decisions log and out-of-scope section updated.

**docs/ARCHITECTURE.md:** `public_results` table + a new `app_config` table for misc admin-tunable operational values (STRAI TTL, etc. — didn't fit `pricing_tiers` or `feature_flags`'s on/off shape); new §7a fully explaining the public-results exception, why it has to work this way, and what's still enforced despite not fitting the normal RLS pattern; `examResults` envelope granularity clarified as one-file-per-exam-all-students (needed once void-question recalc depended on it); new `class`/`attendance` envelope types; branding fields; the editable-grid-component reuse requirement documented in §3; three new threat-model rows for STRAI; resolution log updated. Also fixed a pre-existing formatting bug from the M0-005 PR where the `/infra` and `docker-compose.yml` lines had gotten spliced into the middle of the `/apps/api` folder tree, splitting `/routes`+`/db` from `/payments` — unrelated to this addendum, just found it while editing the same block.

**Three new ADRs:** `ADR-0012` (public result announcement — full alternatives-considered, including the narrower aggregates-only and encrypted-in-URL options that weren't chosen and why), `ADR-0013` (the exact CSV/Excel sanitization technique — leading-apostrophe prefix on string cells only, numeric fields typed not stringified, applied to both import and export universally), `ADR-0014` (no AI/LLM-assisted data processing anywhere, stated as a general product boundary since it's the kind of thing a future feature request could otherwise reasonably assume fits a product built by an AI coding agent).

**docs/TASKS.md:** five new milestones, M8–M12 (Class Management & Attendance, Exam Configuration & Grading, Results/Reporting/Analytics, Manual Import & Safe Editable Results, Public Result Announcement), added as new numbers rather than renumbering M0–M7 (would've broken every existing cross-reference in already-written ADRs/reports). Also retrofitted two existing M3 tasks to avoid future rework: `M3-008` (results table) now explicitly builds the shared editable-grid component from day one instead of being refactored into one later when `M11` needs it; `M3-010` had `FR-RESULTS-05` removed (superseded by `M10-005`'s report card) and now points at `ADR-0013`'s shared sanitization utility instead of a bespoke implementation. Dependency diagram updated; explicitly states M1 is authorized once this PR merges clean, per your Section 8 instruction, and separately notes the one thing that isn't yet confirmed (`NFR-SEC-12`) doesn't block M8–M11's feature logic, only their entitlement-check wiring.

## Deviations

Everything in the 🚩 Flags section above. Nothing else — the rest is a direct, literal translation of Sections 1–7 into the doc structure this project already uses.

## How this was tested

Documentation only, per your Section 8 instruction ("no feature code yet") — no application code changed. Self-review pass: every new `FR-*`/`NFR-*` ID is referenced by at least one `M8`–`M12` task; every new ADR is referenced from the SRS/ARCHITECTURE sections that rely on its decision; the four narrowing flags and the `NFR-SEC-12` proposal are consistently marked as flagged/proposed (not silently presented as settled) across every file that touches them, the same discipline used for the encryption/school-plan decisions in `SHARLO-M0-001`/`007`. `npm run ci` still passes (no application code touched, but re-verified rather than assumed).

## Status

**Docs done. PR open, CI green, waiting for your review before merge — per your explicit "report back once the docs PR is up for my review," not auto-merged the way most of this session's other PRs have been.** M1 has not been started. Once you merge (or tell me to), M1 begins per your Section 8 sequencing, without a further "go" needed beyond that merge — same as you specified.

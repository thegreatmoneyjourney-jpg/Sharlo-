# Report: SHARLO-M0-007 — Incorporate founder decisions (ADR-0005, ADR-0010) + Gulf pricing research

**Status: done.** Both confirmed decisions are now implemented across the docs (not just noted as "confirmed" — the mechanisms they imply are fully designed). Pricing research is complete with sourced numbers and a recommendation; the seed pricing table itself is left unchanged pending your explicit go-ahead, since it's a revenue call and nothing engineering-side depends on it being decided this instant (see §3 below).

---

## 1. Encryption Passphrase — confirmed, plus the reminder cadence you asked for

`docs/ADR/0005-client-side-encryption-key-management.md` is now **Accepted**. Nothing changed about the crypto design itself — you confirmed it as proposed.

What I added for the reminder requirement: this needed a real mechanism, not just a note, so:

- Signup keeps its existing hard gate (can't finish signup without clicking through Recovery Key confirmation) — but that's now explicitly documented as a _soft_ signal, because a click-through isn't proof of anything 30 days later.
- New fields on `users`: `recovery_key_issued_at`, `recovery_key_reminder_7d_sent_at`, `recovery_key_reminder_30d_sent_at`, `recovery_key_reminder_dismissed_at`.
- A daily scheduled job sends both an in-app banner and an email at the 7-day and 30-day marks, to any account that hasn't explicitly re-confirmed. "Re-confirm" requires actually re-downloading the key and clicking a real confirmation — dismissing the banner with the X doesn't count and the reminder comes back.
- This pulled in a new piece of infrastructure that didn't exist in the plan before: **transactional email.** New `docs/ADR/0011-transactional-email-provider.md` recommends **Resend** (simple, good free tier, solid deliverability, natural fit for the rest of this stack) over Amazon SES (cheaper at real scale, but needs an AWS production-access approval and more setup friction than is justified pre-launch) or Postmark (fine, just no edge over Resend here). New task `M0-008` covers the domain email auth (DKIM/SPF/DMARC) setup; `M3-004` now depends on it.

Full design: `docs/ADR/0005-client-side-encryption-key-management.md` (see the addendum at the end) and `docs/SRS.md` FR-AUTH-09.

## 2. School continuity via admin-owned Drive storage — confirmed, mechanism designed

`docs/ADR/0010-school-plan-multi-recipient-encryption.md` is now **Accepted**, including the storage-location call. Your reasoning (institutional trust can't depend on any one teacher's account) is exactly right, and it pointed to a specific correct answer once I dug into how Google Drive actually handles file ownership — worth walking through because it's not just "share a folder":

- **If the school admin has a Google Workspace account** (including the free Workspace for Education tier — common for schools already using Google Classroom): the app creates a **Shared Drive** for the school. This is Google's own mechanism for exactly your requirement — files inside a Shared Drive are owned by the Shared Drive itself, not by whichever teacher created them. A teacher leaving has **zero** effect on the data. This is the clean, fully-backed version of the guarantee you asked for.
- **If the admin only has a personal Gmail account** (no Workspace) — genuinely common among smaller/budget schools, which is a real part of Sharlo's target market, not an edge case: Shared Drives aren't available at all. Fallback is a regular folder the admin owns, shared to teachers. Here's the catch I want to flag rather than paper over: **a file a teacher creates inside a folder they only have Editor access to is owned by that teacher by default**, not by the folder. So the "survives any staff change" guarantee is weaker on this path — mitigated by (a) an ownership-transfer attempt triggered automatically when a teacher is removed, and (b) the product actively steering School admins toward setting up a free Workspace for Education account during onboarding, specifically to get the fully-guaranteed path. I've made sure the product copy for this is honest about which guarantee applies to which path (`docs/ADR/0010` calls this out explicitly) rather than making a blanket promise we can't fully back for every admin.

Also designed: the access-grant flow (a teacher has to complete a one-time Google Picker selection to actually get write access to the school's container — this is a hard technical requirement of the `drive.file` scope model, not a UX choice I made up), and the teacher-removal flow. `docs/TASKS.md` now has this as five concrete tasks (M3-014 through M3-018) instead of three vague ones, and none of them are blocked anymore.

I also noticed while doing this that the SRS never actually had requirement IDs for the School dashboard itself (it was described in the role table and the ADR, but not the requirements section) — added `FR-SCHOOL-01` through `05` to close that traceability gap now that the design is real.

## 3. Gulf pricing research (UAE / Saudi Arabia / Qatar)

You asked for researched numbers before locking launch pricing. Here's what I found and what I'd do with it — **I have not changed the seed pricing table in `docs/SRS.md`**, since this is a revenue call, it doesn't block any engineering (pricing is fully admin-configurable, so changing it later costs nothing), and you asked me to report back the numbers, not necessarily to apply them unilaterally. Say the word and I'll update the seed values to match.

### What the data actually shows

| Market             | Typical teacher pay (USD/yr equivalent)                                                                                                                             | Notes                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| US (Tier 1 anchor) | **$74,495** average, $46,526 starting                                                                                                                               | NEA 2024–25 Benchmark Report. Taxed; teacher pays own housing.                                                                               |
| UAE                | **~$33,000–72,000** typical range (international/private-school teachers); up to ~$98,000 at top international schools                                              | Tax-free, frequently + housing allowance. Public-sector (Emirati-national-facing) schools aren't really part of Sharlo's addressable market. |
| Saudi Arabia       | **~$32,000–48,000** typical for international-school teachers; **~$40,500** broad blended average (incl. local-curriculum teachers)                                 | Tax-free.                                                                                                                                    |
| Qatar              | **~$26,000–60,000** typical (mid-to-top private schools); **~$38,200** broad blended average; independent/public-school teachers start **~$65,000** with allowances | Tax-free.                                                                                                                                    |

The broad-average figures for Saudi (~$40,500) and Qatar (~$38,200) — which I think are the more realistic proxy for who actually signs up for a cheap self-serve tool via SEO, as opposed to the top-tier international-school segment — sit at roughly **50–55% of the US anchor figure**, not close enough to justify Tier-1 parity on pure purchasing-power grounds. UAE's typical range is wide (~45–95% of the US figure depending on school tier), reflecting a real bifurcation: well-paid Western-curriculum international-school teachers at the top, and a much larger population of budget-private-school and local-curriculum teachers below them.

### The segment mismatch that matters for this decision

The Tier-1 seed placement makes the most sense if you're picturing the top of the market — an experienced teacher at a premium Dubai international school, who genuinely earns Tier-1-comparable (or better, tax-free) money. But Sharlo's self-serve, SEO-driven Pro plan is more likely to be found and bought by the much larger population beneath that: budget private schools, tutoring centers, local-curriculum schools — where the broad-average numbers above are the more realistic picture. PPP pricing exists to maximize conversion among exactly that price-sensitive majority; the risk of pricing too high (losing a meaningful share of conversions) is larger than the risk of pricing too low (a small amount of margin left on the table from the minority who'd have paid more anyway) at price points this low ($5.99 vs. $3.99/month — the entire delta is less than the cost of a coffee, but it's still a real psychological threshold for someone paying out of pocket in a market where that's a meaningful fraction of a day's take-home pay).

### Recommendation

**Split Pro and School pricing for these three countries instead of treating them as one Tier-1 bundle:**

- **Pro plan (individual teacher): move UAE, Saudi Arabia, and Qatar to Tier 2 pricing** ($3.99/mo, $39.99/yr) instead of Tier 1. This better matches the typical/broad-average teacher's purchasing power and should convert meaningfully better on self-serve signups without leaving much on the table (a teacher who'd happily pay $5.99 will still buy at $3.99).
- **School plan: keep at Tier 1** ($12/teacher/yr). This is an institutional purchase, not an individual one — school budgets at the private/international schools that would actually adopt a 5+-seat paid tool are not meaningfully price-sensitive at this level (Dubai/Doha/Riyadh international-school tuition routinely runs $10,000–30,000+/year per student; $12/teacher/year is a rounding error regardless of tier).

**Implementation note (no schema change needed):** your `pricing_tiers`/`country_tier_map` design already supports this — I'd recommend adding a distinct **"Gulf" tier row** (`pro_monthly=$3.99, pro_yearly=$39.99, school_per_seat_yearly=$12`) rather than folding these countries into the existing Tier 2 row wholesale, since Tier 2's School price ($9) is lower than what I'm recommending here. This is exactly the kind of per-country customization the admin panel was built to support without a redesign.

This is a recommendation, not something I've applied — confirm (or adjust) and I'll update the seed values in `docs/SRS.md` §3 to match, or leave the current Tier-1 placement in place if you'd rather optimize for the top of the market instead. Either way it's a config change, not an engineering one, whenever you decide.

Sources: [Glassdoor – Teacher, Abu Dhabi](https://www.glassdoor.com/Salaries/abu-dhabi-united-arab-emirates-teacher-salary-SRCH_IL.0,30_IM953_KO31,38.htm) · [GulfTalent – Teacher Salaries UAE](https://www.gulftalent.com/uae/salaries/teacher) · [Teacher Horizons – UAE teacher salary](https://www.teacherhorizons.com/advice/uae-teacher-salary-what-international-teachers-actually-earn) · [ERI – Primary School Teacher Salary, Saudi Arabia](https://www.erieri.com/salary/job/primary-school-teacher/saudi-arabia) · [Teaching Nomad – 2025 Saudi Arabia Salaries](https://www.teachingnomad.com/blog/blog/saudi-arabia-salaries-2025/) · [GulfTalent – Teacher Salaries Saudi Arabia](https://www.gulftalent.com/saudi-arabia/salaries/teacher) · [Suraasa – Teach in Qatar](https://www.suraasa.com/blog/teach-in-qatar-2026) · [WorldSalaries – Average Teacher Salary in Qatar](https://worldsalaries.com/average-teacher-salary-in-qatar/) · [International Teaching Families – Teach in Qatar](https://internationalteachingfamilies.com/destinations/moving-to-the-middle-east/teach-in-qatar/) · [NEA 2024–2025 Teacher Salary Benchmark Report](https://www.nea.org/sites/default/files/2026-04/2024-2025-teacher-salary-benchmark-report-final-new.pdf) · [EdWeek – Average Teacher Pay 2025](https://www.edweek.org/teaching-learning/average-teacher-pay-increased-again-this-year-sort-of-see-how-your-state-fared/2025/05)

## 4. Smaller confirmations, applied as directed

- **Offline-first scanning:** moved out of M1 into a new **Backlog** section at the end of `docs/TASKS.md` (`BACKLOG-001`), explicitly not scheduled into a milestone. `docs/SRS.md` FR-SCAN-06 relabeled to make clear it's approved-but-deferred, not v1 scope.
- **Soft free-tier enforcement — "never hard-block mid-session":** `docs/SRS.md` NFR-SEC-07 and `docs/TASKS.md` M4-006 now both state explicitly that the cap is never enforced mid-scan or mid-session; the warning only ever appears at next app open or on the dashboard.
- **"We can't read your students' data" marketing claim:** confirmed accurate, no doc changes needed — it was already architected to be true (`docs/ARCHITECTURE.md` §7, §11) and `docs/TASKS.md` M6-003 already requires `llms.txt` claims to be cross-checked against actual behavior, which covers keeping it honest as the product evolves.

## 5. What's next

PR #1 (already open from the first push) is being updated with this commit and merged — there's no CI configured yet to gate on (that's `M0-002`/`M0-003`, still ahead of us), so per your instruction I'm merging directly rather than waiting on a check that doesn't exist yet. After that, moving straight into M0 scaffolding (`M0-002` onward) without further check-in, per your direction and `CLAUDE.md`'s working-style section.

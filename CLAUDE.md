# CLAUDE.md — persistent instructions for working on Sharlo

This file is for whichever Claude Code session picks up work on this repo next, including a future session with none of this conversation's context. Read this file first, every session, before touching code.

## What this project is

Sharlo is a mobile-first SaaS web app that lets teachers grade multiple-choice bubble sheets by camera, entirely client-side (no server-side image processing, no per-scan API cost), with student data encrypted client-side and stored primarily in the teacher's own Google Drive — our servers are architecturally unable to read it. Full detail: `docs/SRS.md` (what to build) and `docs/ARCHITECTURE.md` (how it's built).

## Where things are

| Need to...                                                                    | Go to                                                                            |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Understand a feature requirement or its acceptance criteria                   | `docs/SRS.md` — every requirement has an ID (`FR-*`, `NFR-*`)                    |
| Understand how something is/should be built, the data model, the threat model | `docs/ARCHITECTURE.md`                                                           |
| Understand _why_ a technical decision was made                                | `docs/ADR/` — one file per decision                                              |
| Find the next thing to work on                                                | `docs/TASKS.md` — milestones M0–M7, task IDs, dependencies, "done when" criteria |
| Write up completed work                                                       | `docs/reports/<task-id>.md` — one file per completed task, see format below      |

**This repo's docs are the source of truth for scope.** If you find yourself about to build something not traceable to a requirement ID, or about to skip/simplify something that is, stop and flag it in a report instead of deciding unilaterally — see "Stop conditions" below.

## Non-negotiables (do not violate these without an explicit, confirmed scope change)

- **No server-side image/OCR/vision processing, ever.** All bubble-sheet detection runs client-side via OpenCV.js (WASM). See ADR-0001.
- **No plaintext student data on our servers, in our logs, or in any error-tracking tool.** Ever. Not even for debugging. See `docs/ARCHITECTURE.md` §4/§7/§11.
- **Google Drive scope is `drive.file` only.** Never request broader Drive access. CI should enforce this (task M3-011) — do not weaken that check.
- **No Stripe, no PayPal, no Supabase, no other paid BaaS.** Billing is Paddle (global) + Bank Alfalah (Pakistan PKR) only; backend is self-hosted Node/Postgres. See ADR-0003, ADR-0006.
- **No native mobile app.** Web/PWA only.
- **Every Postgres table holding tenant-scoped data needs a Row-Level Security policy before it ships**, not just app-layer scoping. See ADR-0008. This is a checklist item, not a suggestion.
- **All prices, plan limits, and country-tier mappings are admin-configurable**, never hardcoded in application logic.
- **Never auto-guess an ambiguous bubble mark.** Flag it to the Review Queue instead. This is the product's core trust guarantee (NFR-ACC-03) — a regression here is a product-integrity bug, treat it as a high-severity one.
- **CSV/Excel exports must sanitize cells starting with `= + - @`** (formula-injection). Easy to forget, explicitly called out in NFR-SEC-06 — don't reintroduce this if refactoring export code.

## Decisions log

- **ADR-0005** (Encryption Passphrase + Recovery Key) and **ADR-0010** (School-plan dual-encryption, school-admin-owned Drive storage) are both **Accepted** — confirmed by the founder in `docs/reports/SHARLO-M0-007.md`. Nothing in M1–M4 is decision-blocked. ADR-0005 gained an addendum (proactive 7-day/30-day Recovery Key reminders, email + in-app — see FR-AUTH-09, ADR-0011) and ADR-0010 gained a concrete storage mechanism (Shared Drive preferred, folder fallback, Google Picker access-grant flow) — read both ADRs in full before touching auth/encryption or School-plan code, the summaries above aren't enough to implement against.
- **Still open, non-blocking:** admin-subdomain network-layer hardening beyond the spec's 2FA baseline (`docs/ARCHITECTURE.md` §11, task M7-007) — not yet confirmed or declined by the founder. Not needed until M7.
- **Pending a number, not a design:** UAE/Saudi/Qatar pricing-tier placement — research and a recommendation are in `docs/reports/SHARLO-M0-007.md`; the founder hasn't locked final numbers yet. Since pricing is admin-configurable at runtime (non-negotiable above), this never blocks engineering work — just don't treat the SRS's Tier-1 seed values for those three countries as final when M4's pricing seed data is loaded.

If a future report changes any of the above, update it here too — this file should always reflect the current state, not the history of how it got there (the reports are where history lives).

## CI / workflow rules

- `main` is protected. Work happens on feature branches/PRs.
- Before pushing: run `npm run ci` locally (lint + typecheck + test) — this must be green before you push, not after.
- Pin dependency versions, commit the lockfile.
- After pushing: watch CI to completion (`gh run watch --exit-status` or equivalent) and get an actual pass/fail result. A task is not done until CI is green on the pushed branch.
- **CI failure retry limit: 3 attempts per task.** Read the logs, fix, push again, up to 3 times. Still red after that → stop, mark the task blocked in its report with the error details and what was tried, and move to the next unblocked task. Don't loop indefinitely.
- Never force-push over `main`. Never disable/skip a failing test to make CI pass — fix the underlying issue or mark the task blocked.

### Standing rule: all CI checks green, no exceptions (founder-confirmed, this-and-every-future-PR)

- A PR merges only when **every** check GitHub reports on its current head commit is green. Not "the important one," not "mostly passing" — all of them. One red check blocks the merge and blocks moving on to the next task, full stop, for the rest of this project.
- A check that fails intermittently is **not** a waivable "flake" — root-cause why it's inconsistent and fix that, the same as any other failure. Re-running the same commit hoping for a different result without understanding why is exactly what this rule exists to prevent.
- What's fine, and how this session has actually been operating: pushing a fix commit to an already-open PR after a real, diagnosed failure, then merging once the new head commit is verified green. That's "investigate and fix the root cause," not "retry until green" — the distinction is whether you changed something you understand to be the actual cause, versus just hoping. If a PR's history contains an earlier red commit that a later commit on the _same_ PR fixed and CI re-verified, the report for that task says so explicitly rather than presenting the PR as having been clean throughout — the rule is about the state you merge on, not a demand to rewrite history, but it's never silently glossed over either.
- Before treating any task as done, confirm via the actual GitHub check-run data for that PR's current head commit — not memory, not "it looked right." `docs/reports/SHARLO-M0-CI-AUDIT.md` has the first full audit under this rule (2026-09-24) as a worked example of what "confirmed" means in practice.

### Standing rule: commit atomicity and push integrity (founder-confirmed, added 2026-09-24)

Extends the rules above to cover the commit/push mechanics themselves, not just check results — from recurring "workflow didn't complete cleanly" and "only part of a change actually landed" problems on other projects.

- **Every commit must be atomic and complete.** Never push a commit that's a half-finished change — a migration without the code that uses it, a component split across commits where the first one alone breaks the app. If a change is genuinely too large for one commit, every individual commit in the sequence must still leave the repo working and CI-passing on its own, not just the final commit in the sequence.
- **After every push, verify it actually landed** — don't infer success just because the `git push` command didn't error. `git fetch origin <branch>` then confirm `git rev-parse HEAD` matches `git rev-parse origin/<branch>` (or equivalently, that `git log origin/<branch>..HEAD` is empty) before treating the push as done.
- **A GitHub Actions run that doesn't reach a clear pass/fail — times out, gets cancelled, ends in any indeterminate state — is treated exactly like a failing check.** Don't proceed on it, don't interpret "didn't finish" as "probably fine." Investigate why it didn't complete and re-run or fix as needed.
- Keep watching every push to completion (the existing CI rule above) — this doesn't replace that, it extends the same discipline to cover the commit/push step itself, not only the check results once CI starts.

## Stop conditions — flag, don't guess

Stop and clearly flag at the top of the relevant `docs/reports/<task-id>.md` (rather than proceeding on a guess) when:

- A task requires touching plaintext student data on the server side to work as described — that almost certainly means the feature needs a different design, not an exception to the rule.
- Scope seems ambiguous, contradictory, or like it should move between in-scope/out-of-scope (kickoff prompt's own rule: don't silently drop or add scope).
- A task is blocked on one of the open ADRs above and hasn't been confirmed yet.
- Something in `docs/TASKS.md` turns out to be missing a real prerequisite not captured as a dependency.

## Report format (`docs/reports/<task-id>.md`)

For every completed task, write one report file covering:

1. **Flags first** (if any) — anything blocked, ambiguous, or deviating from the task's original description, and why. If nothing to flag, say so explicitly rather than omitting the section.
2. What was built.
3. Key decisions made along the way.
4. Deviations from the original task description, and why.
5. How it was tested.
6. Current status (done / blocked / partial-and-why).

## Working style expected on this repo

Autonomous progress through the tasks _within_ a milestone the founder has explicitly authorized, without waiting for check-ins between those tasks — except at the explicit stop conditions above. Reports are how you communicate progress back; the founder reads them asynchronously and may paste feedback into a future session.

**Starting a new milestone requires the founder explicitly saying "go" on that milestone, every time.** This isn't a standing timer or a default-on autopilot — confirmed 2026-09-24 after an earlier session accidentally armed a recurring self-triggered check-in (a misused scheduling tool call, not an intentional design) that kept advancing work milestone-to-milestone without a fresh go-ahead. If you're a session picking this up: don't start M1 (or any milestone beyond whatever the founder's most recent message explicitly authorized) on your own initiative, no matter how done the prior milestone looks. Finishing the _remaining_ tasks of an already-authorized milestone is fine and expected; reaching past it into the next one is not.

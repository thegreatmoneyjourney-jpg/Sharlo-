# CLAUDE.md — persistent instructions for working on Sharlo

This file is for whichever Claude Code session picks up work on this repo next, including a future session with none of this conversation's context. Read this file first, every session, before touching code.

## What this project is

Sharlo is a mobile-first SaaS web app that lets teachers grade multiple-choice bubble sheets by camera, entirely client-side (no server-side image processing, no per-scan API cost), with student data encrypted client-side and stored primarily in the teacher's own Google Drive — our servers are architecturally unable to read it. Full detail: `docs/SRS.md` (what to build) and `docs/ARCHITECTURE.md` (how it's built).

## Where things are

| Need to... | Go to |
|---|---|
| Understand a feature requirement or its acceptance criteria | `docs/SRS.md` — every requirement has an ID (`FR-*`, `NFR-*`) |
| Understand how something is/should be built, the data model, the threat model | `docs/ARCHITECTURE.md` |
| Understand *why* a technical decision was made | `docs/ADR/` — one file per decision |
| Find the next thing to work on | `docs/TASKS.md` — milestones M0–M7, task IDs, dependencies, "done when" criteria |
| Write up completed work | `docs/reports/<task-id>.md` — one file per completed task, see format below |

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

## Two decisions are still open — check before building on them

- **ADR-0005** (Encryption Passphrase + Recovery Key wrapping a master key) — proposed resolution to a real contradiction in the original spec (Google-only auth has no "account password" to derive a key from). Needs founder confirmation before M3 encryption tasks (M3-003 onward) start. If it's confirmed, update this file's status line for it to "Accepted" and remove this caveat.
- **ADR-0010** (School-plan dual-encryption for principal dashboards) — a genuinely new mechanism, not in the original spec, needed to make "school-wide results" possible without breaking "servers can't read student data." Needs founder confirmation before M3-014/015/016 and any School-plan work in M4/M5. Individual teacher (Free/Pro) work is not blocked by this.

Check `docs/reports/SHARLO-M0-001.md` for the founder's response if one has been pasted back into a later session — if confirmed/amended there, treat that as the current answer over the ADR's "Proposed" status until the ADR file itself is updated to match.

## CI / workflow rules

- `main` is protected. Work happens on feature branches/PRs.
- Before pushing: run `npm run ci` locally (lint + typecheck + test) — this must be green before you push, not after.
- Pin dependency versions, commit the lockfile.
- After pushing: watch CI to completion (`gh run watch --exit-status` or equivalent) and get an actual pass/fail result. A task is not done until CI is green on the pushed branch.
- **CI failure retry limit: 3 attempts per task.** Read the logs, fix, push again, up to 3 times. Still red after that → stop, mark the task blocked in its report with the error details and what was tried, and move to the next unblocked task. Don't loop indefinitely.
- Never force-push over `main`. Never disable/skip a failing test to make CI pass — fix the underlying issue or mark the task blocked.

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

Autonomous, milestone-by-milestone progress through `docs/TASKS.md`, without waiting for check-ins between tasks — except at the explicit stop conditions above. Reports are how you communicate progress back; the founder reads them asynchronously and may paste feedback into a future session.

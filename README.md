# Sharlo

Grade multiple-choice bubble sheets by camera — no scanner, no per-scan cost, no server ever seeing student data.

A teacher shows a bubble sheet to their phone or laptop camera; within ~2 seconds it's detected and scored, and the app is ready for the next sheet. Anything the engine can't confidently read is flagged for a quick manual review instead of being auto-guessed. Results land in an editable table with per-class analytics, export, and printable result cards.

> **Project status (updated 2026-10-03):** M0 (repo/planning foundation), M1 (scanning engine core), M2 (templates & review queue), and M3 (accounts, auth & Drive sync) are done and founder-confirmed — sign-in, client-side encryption, camera/batch scanning, the Review Queue, rostering, results/analytics/export, and the School plan's multi-tenant dual-encryption all work end to end today. Active development has just handed off from Claude Code to Cline for M4 (Billing) onward — **see `HANDOFF.md` for the full picture before anything else.**

## Documentation

**If you're picking up development on this repo, read [`HANDOFF.md`](HANDOFF.md) first, then [`.clinerules`](.clinerules) — in that order, before anything below.** They have the current project state, what's built, what's blocked, and the exact rules to follow on every task.

Everything else, in the order `HANDOFF.md` itself points to next:

1. [`docs/SRS.md`](docs/SRS.md) — what the product must do (functional + non-functional requirements, acceptance criteria).
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how it's built (system design, data model, encryption design, threat model).
3. [`docs/ADR/`](docs/ADR) — why specific technical decisions were made, one file per decision.
4. [`docs/TASKS.md`](docs/TASKS.md) — the work, broken into milestones and tracked tasks, with a full deep spec for every not-yet-started task.
5. [`docs/TASK-WORKFLOW.md`](docs/TASK-WORKFLOW.md) — the literal, step-by-step sequence to follow for every task.
6. [`docs/reports/`](docs/reports) — one report per completed task, written as work lands.
7. [`CLAUDE.md`](CLAUDE.md) — the persistent decisions log for AI-assisted development on this repo (history of what was decided and why, kept current).

## Tech stack

| Layer                      | Choice                                                                             | Why                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Frontend                   | Next.js (App Router), React, TypeScript                                            | SSR for SEO/AEO/GEO, one codebase for marketing + app + admin. See ADR-0002.                       |
| Scanning/detection         | OpenCV.js (WASM), 100% client-side                                                 | Zero per-scan cost, zero raw-image server exposure. See ADR-0001.                                  |
| Backend API                | Fastify + TypeScript + Zod                                                         | Lightweight, strong TS ergonomics, low overhead on a small VPS. See ADR-0007.                      |
| Database                   | PostgreSQL (self-hosted), Drizzle ORM, Row-Level Security                          | No BaaS billing surprises; RLS as a hard multi-tenancy backstop. See ADR-0003, ADR-0007, ADR-0008. |
| Primary student data store | Teacher's own Google Drive (`drive.file` scope), client-side AES-256-GCM encrypted | Our servers can't read student data because they never receive it. See ADR-0004.                   |
| Auth                       | Sign in with Google (redirect OAuth, PKCE)                                         | One-step auth + Drive consent.                                                                     |
| Payments                   | Paddle (global MoR) + Bank Alfalah (Pakistan PKR)                                  | No Stripe/PayPal. See ADR-0006.                                                                    |
| Hosting                    | Hetzner VPS, Docker Compose, Caddy                                                 | Low fixed cost, solo-operable. See ADR-0009.                                                       |

Full rationale for every choice above lives in `docs/ADR/`.

## Local development

npm workspaces monorepo: `apps/web` (Next.js — marketing site, teacher app, admin) and `apps/api` (Fastify — accounts, billing, admin, usage counters; see `docs/ARCHITECTURE.md` §5 for what it deliberately does _not_ handle).

Prerequisites: Node.js 22+.

```bash
npm install          # installs both workspaces from the root
npm run dev:web       # http://localhost:3000
npm run dev:api        # http://localhost:4000/health
```

Postgres/Drizzle and Docker Compose are fully wired up (see `apps/api/.env.example` and the root `.env.example` for the env vars each needs) — the two dev servers above are enough for frontend-only work, but most backend routes need a real local Postgres running; see `infra/README.md` for the Docker Compose path.

## Running CI checks locally

```bash
npm run ci      # prettier --check, eslint, tsc --noEmit, vitest — across both workspaces
npm run build    # production build of both workspaces
```

This is exactly what `.github/workflows/ci.yml` runs on every push/PR — run it yourself before pushing, per `CLAUDE.md`.

## Contributing / working conventions

See `CLAUDE.md` for CI rules, the report-writing convention, and the non-negotiable architectural constraints (no server-side image processing, `drive.file` scope only, no auto-guessing ambiguous marks, etc.).

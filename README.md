# Sharlo

Grade multiple-choice bubble sheets by camera — no scanner, no per-scan cost, no server ever seeing student data.

A teacher shows a bubble sheet to their phone or laptop camera; within ~2 seconds it's detected and scored, and the app is ready for the next sheet. Anything the engine can't confidently read is flagged for a quick manual review instead of being auto-guessed. Results land in an editable table with per-class analytics, export, and printable result cards.

> **Project status:** planning phase. The docs below define the full v1 scope and are awaiting founder review before feature code is written. See `docs/TASKS.md` M0 for the repo-scaffolding work that comes next.

## Documentation

Start here, in this order:

1. [`docs/SRS.md`](docs/SRS.md) — what the product must do (functional + non-functional requirements, acceptance criteria).
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how it's built (system design, data model, encryption design, threat model).
3. [`docs/ADR/`](docs/ADR) — why specific technical decisions were made, one file per decision.
4. [`docs/TASKS.md`](docs/TASKS.md) — the work, broken into milestones and tracked tasks.
5. [`docs/reports/`](docs/reports) — one report per completed task, written as work lands.
6. [`CLAUDE.md`](CLAUDE.md) — persistent working instructions for AI-assisted development on this repo.

If you only read one thing before the SRS/ARCHITECTURE docs, read `docs/reports/SHARLO-M0-001.md` — it's short and flags the handful of real decisions this plan needs from the founder before certain milestones can proceed.

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

Postgres/Drizzle, Docker Compose, and env var wiring land in `docs/TASKS.md` tasks `M0-004`–`M0-006` — until then there's nothing to configure beyond the two dev servers above.

## Running CI checks locally

```bash
npm run ci      # prettier --check, eslint, tsc --noEmit, vitest — across both workspaces
npm run build    # production build of both workspaces
```

This is exactly what `.github/workflows/ci.yml` runs on every push/PR — run it yourself before pushing, per `CLAUDE.md`.

## Contributing / working conventions

See `CLAUDE.md` for CI rules, the report-writing convention, and the non-negotiable architectural constraints (no server-side image processing, `drive.file` scope only, no auto-guessing ambiguous marks, etc.).

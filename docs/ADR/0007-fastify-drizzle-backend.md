# ADR-0007: Fastify + Drizzle ORM for the backend API

**Status:** Accepted

## Context

The kickoff prompt asks for "Node.js/TypeScript recommended — propose the specific framework." The backend is intentionally thin (`docs/ARCHITECTURE.md` §5) — accounts, billing, admin, usage counters, template metadata — and needs to run comfortably on a small VPS, be maintainable by a solo founder (plus AI-assisted development) over time, and enforce strict schema validation at the boundary since it's handling billing and auth.

## Decision

**Fastify** as the HTTP framework, with **Zod** for request/response schema validation, and **Drizzle ORM** for the Postgres data layer.

## Alternatives considered

- **NestJS.** Rejected — NestJS's DI/module/decorator architecture is well-suited to larger teams and larger codebases; for a backend this deliberately small, it's more ceremony and more framework-specific knowledge to hold in your head than the problem justifies. Revisit only if the backend's scope grows substantially beyond its current design.
- **Plain Express.** Rejected — Fastify offers meaningfully better TypeScript ergonomics and built-in schema validation hooks (important given billing/webhook correctness matters a lot here) with comparable simplicity and better out-of-the-box performance, for effectively the same learning cost.
- **Prisma ORM instead of Drizzle.** A close call — Prisma has a larger ecosystem and more familiar migration workflow. Drizzle was chosen for being SQL-first and explicit (less "magic" to debug in a solo-maintained codebase), a lighter runtime (no separate query-engine binary), and because it composes cleanly with hand-written Postgres Row-Level Security policies (ADR-0008), which is a core requirement here and something Prisma's abstraction layer makes slightly more awkward to reason about alongside.

## Consequences

- Zod schemas double as the contract for request validation (NFR-SEC-04) and can be shared with the frontend for form validation, reducing duplicated validation logic.
- Drizzle's migration files are the single source of truth for schema changes — no manual `ALTER TABLE` against production, ever (`docs/ARCHITECTURE.md` §14).
- Smaller ecosystem/community than Prisma or NestJS means slightly less Stack-Overflow-style precedent to lean on — an accepted tradeoff for the fit described above.

# ADR-0003: Self-hosted Node.js/TypeScript API + PostgreSQL on a VPS, not Supabase or another BaaS

**Status:** Accepted

## Context

The kickoff prompt explicitly rules out Supabase and paid BaaS platforms to keep infrastructure cost near-zero while scaling, and specifies a lightweight self-hosted API + Postgres on a small VPS.

## Decision

A self-hosted Fastify (Node.js/TypeScript) API and a self-hosted PostgreSQL instance, both running on a Hetzner VPS via Docker Compose (see ADR-0007, ADR-0009).

## Alternatives considered

- **Supabase / Firebase / other BaaS.** Rejected per explicit founder instruction — these bill per-project-usage in ways that scale with our user base (database rows, auth users, storage, realtime connections), which works against the "near-zero cost as we scale" goal, and would put a third party in a position to see more of our data model than necessary. Also, given that most sensitive data structurally lives outside our database entirely (`docs/ARCHITECTURE.md` §7), a BaaS's main selling points (built-in auth, realtime, storage) aren't doing much useful work for us anyway.
- **Managed Postgres (e.g., RDS-equivalent) instead of self-hosted.** Considered reasonable but deferred — adds ongoing cost at a scale where a well-backed-up self-hosted instance (nightly `pg_dump` + volume snapshots, see `docs/ARCHITECTURE.md` §12) is sufficient. Revisit if backup/ops burden grows or uptime requirements tighten materially.

## Consequences

- We own backup, patching, and uptime for Postgres — mitigated by keeping the schema small (most sensitive data isn't here, per ADR-0004) and automating backups from day one (an M0/M7 task, not an afterthought).
- No vendor usage-based billing surprise as the user base grows — cost is dominated by a fixed VPS bill, which is the explicit goal.
- We take on the (small, well-understood) responsibility of writing our own auth session handling and admin tooling rather than getting them for free from a BaaS — acceptable given how thin that layer actually needs to be (`docs/ARCHITECTURE.md` §5, §9).

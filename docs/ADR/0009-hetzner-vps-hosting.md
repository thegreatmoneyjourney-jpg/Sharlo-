# ADR-0009: Hetzner VPS, Docker Compose, Caddy — infrastructure baseline

**Status:** Accepted

## Context

The kickoff prompt asks for a small VPS setup (suggesting Hetzner as an example) to keep infrastructure cost near-zero, run by a solo founder with engineering support rather than an ops team.

## Decision

Hetzner Cloud, starting on a CPX21/CPX31-class instance, running the Fastify API, Postgres, and a Caddy reverse proxy via Docker Compose. Nightly `pg_dump` backups to S3-compatible object storage plus periodic Hetzner volume snapshots. GitHub Actions for CI and a simple SSH/Compose-based deploy on merge to `main`.

## Alternatives considered

- **Other budget VPS providers (DigitalOcean, Linode/Akamai, Vultr).** All reasonable; Hetzner chosen primarily because the founder's own kickoff prompt suggested it and its price-to-resource ratio is consistently strong, with no specific requirement pulling toward an alternative.
- **Kubernetes (even a lightweight distribution like k3s).** Rejected — meaningfully more operational surface (cluster upgrades, manifest complexity) than a solo-founder product at this scale needs; Compose gives "restart on crash" and simple multi-container orchestration for a fraction of the ops burden.
- **Managed platform-as-a-service (Render, Railway, Fly.io) instead of a raw VPS.** Considered — genuinely lower ops burden, at meaningfully higher cost per unit of compute/storage than a raw VPS, and less control over the exact self-hosted-Postgres setup the kickoff prompt calls for. Rejected primarily on the explicit "small VPS" instruction and cost-minimization goal; worth revisiting if solo-founder ops time becomes the tighter constraint than money as the product grows.

## Consequences

- We own OS/Docker/Postgres patching and backup verification — mitigated by keeping the stack deliberately simple (three containers) and automating backups/monitoring from the start rather than as a launch-week scramble.
- Vertical scaling (bigger instance) is the first lever if load grows; horizontal scaling/managed-Postgres migration is a deliberate future decision, not a day-one requirement (NFR-SCALE-02 explicitly sets this expectation).
- Brief downtime during deploys is accepted for v1 (no blue/green setup) — an explicit, reviewable tradeoff, not an oversight.

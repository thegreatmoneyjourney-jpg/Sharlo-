# Deploying Sharlo (Hetzner VPS + Docker Compose + Caddy)

Config-as-code for `docs/TASKS.md` task `M0-005`. Everything here can be reviewed and built without a live server; actually running it needs a VPS, which needs the founder's Hetzner account (see `docs/reports/SHARLO-M0-005.md` for why that's not something a Claude Code session provisions itself).

Matches `docs/ARCHITECTURE.md` §12: Hetzner VPS, Docker Compose (Postgres + Fastify API + Next.js web + Caddy), no Kubernetes, brief deploy downtime accepted for v1.

## Prerequisites

- A Hetzner Cloud server (CPX21/CPX31-class per `ARCHITECTURE.md` §12 is plenty to start), with Docker and the Docker Compose plugin installed.
- Two DNS records pointing at the server's public IP — the exact hostnames you'll use for `APP_DOMAIN` and `API_DOMAIN` below. **Set these before first startup, not after** — Caddy requests a Let's Encrypt certificate for each domain on container start, and that fails if the domain doesn't resolve to this server yet.
- This repo cloned onto the server.

## First-time setup

```bash
cp .env.example .env
```

Fill in `.env` with real values:

- `POSTGRES_PASSWORD` and `APP_DB_ROLE_PASSWORD` — two **different** generated secrets (e.g. `openssl rand -base64 32` each). Never reuse one for the other — they're deliberately different Postgres roles with different privilege levels (`ARCHITECTURE.md` §8).
- `APP_DOMAIN` / `API_DOMAIN` — the real domains you pointed DNS at above.

Then:

```bash
docker compose up -d --build
```

First run: Postgres initializes, `api`'s entrypoint (`apps/api/docker-entrypoint.sh`) runs migrations and provisions the restricted `app_user` role before the API starts accepting requests, `web` serves the Next.js app, and Caddy issues certificates and starts reverse-proxying. Check `docker compose logs -f caddy` if certificate issuance is slow/stuck — almost always a DNS propagation or firewall (ports 80/443 open?) issue, not a Caddy config problem.

## Common operations

```bash
docker compose logs -f api        # tail one service's logs
docker compose ps                  # what's running
docker compose restart api          # restart one service
docker compose up -d --build web     # rebuild + redeploy just one service after a code change
docker compose down                   # stop everything (volumes — pgdata, caddy_data — persist)
```

## What this does _not_ yet cover

Deliberately out of scope for M0-005's "config-as-code, no live server needed" slice — tracked separately, not silently skipped:

- **Automated backups** (`pg_dump` to object storage, per `ARCHITECTURE.md` §12) — task `M7-008`. Until then, back up manually: `docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql`.
- **CI/CD auto-deploy on merge to `main`** — `ARCHITECTURE.md` §12 describes this as a later addition (SSH + `docker compose pull/up`, or a registry push/pull); for now, deploying a new version means pulling the latest code and re-running the `docker compose up -d --build` command above by hand on the server.
- **Admin subdomain** — see the comment in `infra/Caddyfile`; not wired up until the admin panel exists as its own route/deploy target (M5).
- **Object storage** (S3-compatible, for non-sensitive template assets, `ARCHITECTURE.md` §6/§12) — not needed until M2's template work lands.

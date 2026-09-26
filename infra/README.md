# Deploying Sharlo (Hetzner VPS + Docker Compose + Caddy)

Config-as-code for `docs/TASKS.md` task `M0-005`. Everything here can be reviewed and built without a live server; actually running it needs a VPS, which needs the founder's Hetzner account (see `docs/reports/SHARLO-M0-005.md` for why that's not something a Claude Code session provisions itself).

Matches `docs/ARCHITECTURE.md` §12: Hetzner VPS, Docker Compose (Postgres + Fastify API + Next.js web + Caddy), no Kubernetes, brief deploy downtime accepted for v1.

## Prerequisites

- A Hetzner Cloud server (CPX21/CPX31-class per `ARCHITECTURE.md` §12 is plenty to start), with Docker and the Docker Compose plugin installed.
- DNS records pointing at the server's public IP for `APP_DOMAIN` and `API_DOMAIN` below (and, once M5 wires up the admin subdomain, a third for it) — see "DNS (Cloudflare)" below for the exact records. **Set these before first startup, not after** — Caddy requests a Let's Encrypt certificate for each domain on container start, and that fails if the domain doesn't resolve to this server yet.
- This repo cloned onto the server.

## DNS (Cloudflare)

The domain is registered with a standard registrar, but DNS itself is managed through **Cloudflare's free plan** rather than the registrar's own DNS panel — free DDoS protection and a basic WAF on top of plain DNS, no extra recurring cost (the only recurring cost is the domain registration itself). Point the domain's nameservers at Cloudflare's (from the registrar's panel), then configure everything below inside Cloudflare.

### A records (all → the VPS's public IP)

| Host                                                                      | Points to | Proxy status                                                                 |
| ------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------- |
| `APP_DOMAIN` (apex + marketing/app, `ARCHITECTURE.md` §12)                | VPS IP    | **Proxied (orange-cloud)**                                                   |
| `API_DOMAIN`                                                              | VPS IP    | **Proxied (orange-cloud)** — see the webhook note below before changing this |
| admin subdomain (not wired until M5 — see "What this does not yet cover") | VPS IP    | **Proxied (orange-cloud)**                                                   |

**Why proxied everywhere, including the admin subdomain and the webhook-receiving API domain:**

- The admin subdomain gets the same DDoS/WAF protection as everything else, and — importantly — **Cloudflare Access (`M7-007`'s recommended admin network-layer hardening) requires the DNS record to already be proxied**, so leaving this orange-cloud now keeps that later option open rather than requiring a DNS change first.
- Cloudflare's proxy is designed to be transparent to normal HTTPS traffic, including webhook delivery (POST requests from Paddle/Bank Alfalah) — this is an extremely common pattern (Stripe, GitHub, and most SaaS webhook senders are routinely used behind Cloudflare-proxied endpoints). **This environment's network access is restricted and could not reach Paddle's live developer documentation to double-check their current stated requirements** (attempted and blocked — see `docs/reports/SHARLO-M0-014.md`), so this is a well-reasoned default, not an independently re-verified fact. Treat `M4-003` (the Paddle adapter task) as the real verification point: send a real sandbox webhook once that task is being built, and if delivery fails or times out while proxied, switch `API_DOMAIN`'s record to **DNS-only (grey-cloud)** as the fallback — a five-minute change, not a redesign. The much more common real gotcha with a proxy in front of a webhook endpoint isn't the proxy itself, it's an over-aggressive Cloudflare WAF/rate-limit rule blocking the sender's POSTs, or signature verification reading a body the proxy re-encoded — both are configuration/code-level concerns to check first if a real webhook ever fails to arrive, before assuming grey-cloud is needed.
- Bank Alfalah's own webhook infrastructure requirements are effectively unverifiable from here (a local Pakistani bank gateway, not a widely-documented public API) — same fallback applies: verify with a real test callback when `M4-004` is built, adjust proxy mode only if actually needed.

### Email records (Resend + Zoho)

Two senders share this domain — Resend (transactional app email: signup confirmations, Recovery Key reminders, `ADR-0011`) and Zoho Mail (role-based human inboxes: `support@`, `billing@`, `hello@`, also `ADR-0011`). Exact record _values_ come from each provider's own domain-verification step when the account is created (Resend's and Zoho's dashboards each generate their own DKIM key and tell you the exact selector) — the shapes below are what to expect, not literal values to copy.

- **MX** — Zoho's mail-server records only (typically 2–3 priority-ordered hosts; Zoho's setup wizard gives the exact values for your account). Resend is send-only and needs no MX record.
- **SPF — exactly one `TXT` record on the apex domain, listing _both_ senders' includes.** This is the easy mistake: SPF allows only one record per domain, so Resend's and Zoho's setup instructions (each written as if it's the only sender) must be _merged_ into one record — e.g. shaped like `v=spf1 include:_spf.resend.com include:zoho.com ~all` (exact include hosts per each provider's own instructions) — never added as two separate `TXT` records, which breaks SPF for both senders at once.
- **DKIM — one `TXT` record per sender, no conflict.** Each provider signs with its own selector subdomain (e.g. `resend._domainkey.<domain>`, and whatever selector Zoho's wizard assigns, such as `zmail._domainkey.<domain>`), so both coexist fine as separate records.
- **DMARC — one `TXT` record on `_dmarc.<domain>`**, covering both senders collectively (a message passes DMARC if it aligns with _either_ a passing SPF or a passing DKIM check for that sender).

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
- **Admin subdomain** — see the comment in `infra/Caddyfile`; not wired up until the admin panel exists as its own route/deploy target (M5). Its DNS record (see "DNS (Cloudflare)" above) can and should be created now regardless — it costs nothing to have it sit unused until M5, and it's one less thing to remember at that point.
- **Object storage** (S3-compatible, for non-sensitive template assets, `ARCHITECTURE.md` §6/§12) — not needed until M2's template work lands.

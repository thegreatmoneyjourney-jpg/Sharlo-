# Report: SHARLO-M0-005 — Docker Compose config-as-code (VPS provisioning still blocked)

**Status: split, as expected — config-as-code done, live provisioning blocked on the founder (acknowledged, not a new flag).**

## Flags

1. **Everything here is unverified against a live server or DNS, by necessity.** This sandbox has no reachable Docker daemon (established in `docs/reports/SHARLO-M0-006.md`), so nothing here could be run end-to-end locally. What I did instead, same pattern as M0-006: added a CI job (`docker-build` in `.github/workflows/ci.yml`) that actually builds both Docker images and validates `docker-compose.yml`'s syntax/interpolation on GitHub's runners, which do have a real Docker daemon. That catches real build failures (a bad `COPY` path, a broken multi-stage reference, invalid Compose YAML) but **cannot** catch anything that only shows up with a live server: Caddy's Let's Encrypt certificate issuance against real DNS, the containers actually talking to each other over the real published ports, migrations running against a Postgres that isn't an ephemeral CI container. That part only gets verified once there's a real VPS — flagging clearly so "CI is green on this" isn't mistaken for "this has been deployed and works."
2. **One specific assumption this report can't confirm until CI actually runs it**: `apps/api/Dockerfile` and `apps/web/Dockerfile` each `COPY` only the relevant workspace's `package.json` (not `apps/web`'s when building `api`, or vice versa) into a build stage whose root `package.json` still declares `workspaces: ["apps/*"]`. I'm fairly confident this resolves fine — npm's workspace glob only matches directories actually present at install time — but "fairly confident" is exactly the standard this project just moved away from. The new `docker-build` CI job (below) either proves it or doesn't; this report is being written before that result is in, and this line stays here rather than getting quietly edited away, however it turns out.

## What was built

- `apps/web/next.config.ts`: added `output: 'standalone'` — a lean, self-contained production build Next.js traces automatically, so the runtime image doesn't need `node_modules` installed into it at all.
- `apps/web/Dockerfile`: two-stage build (compile with full deps → copy just the standalone output + static assets + public folder into a clean `node:22-alpine` runner).
- `apps/api/Dockerfile`: three-stage build (compile with dev deps → separate production-only `node_modules` install via `npm ci --omit=dev` → runner combining both). Both Dockerfiles build from the **repo root** as context (not their own `apps/*` directory), since npm workspaces need the root `package.json`/lockfile present to resolve correctly — documented as a comment in each Dockerfile so it's not a silent "why doesn't this build if I `cd` into apps/api first" trap later.
- `apps/api/docker-entrypoint.sh`: runs `node dist/db/migrate.js` (idempotent — same role-provisioning-then-migrate-then-grant ordering as local dev, `docs/reports/SHARLO-M0-006.md`) before `exec`-ing into the actual server process, so the container never accepts requests against a not-yet-migrated database, and so it becomes PID 1 for correct signal handling rather than staying a wrapped child process.
- `docker-compose.yml` (repo root): `postgres` (no published port — only reachable from other containers, not the VPS's public interface), `api`, `web`, `caddy` (the only service with published ports, 80/443). Postgres owner and `app_user` credentials are two distinct required env vars (`:?set in .env` — Compose refuses to start rather than silently running with an empty/default secret).
- `infra/Caddyfile`: reverse-proxies `$APP_DOMAIN` → `web`, `$API_DOMAIN` → `api`. Admin subdomain deliberately **not** wired up — commented explaining why (the admin panel isn't a separate route/deploy target in the codebase yet, that's M5; routing an admin subdomain at `web` now would make `ARCHITECTURE.md` §11's "separate deploy target" claim false).
- Root `.env.example`: documents every variable `docker-compose.yml` needs, distinct in purpose from `apps/api/.env.example` (that one's for running `apps/api` directly via `npm run dev`, not through Docker) — said explicitly in both files' headers so the two don't get confused for each other.
- `infra/README.md`: the actual deployment runbook — prerequisites, the DNS-before-first-startup ordering that Caddy's certificate issuance depends on, first-run steps, common operations, and an explicit list of what this deliberately doesn't cover yet (automated backups, CI/CD auto-deploy, object storage) with the task IDs those belong to, rather than leaving their absence unexplained.
- CI: new `docker-build` job — builds both images, validates `docker-compose.yml` with `docker compose config --quiet` against throwaway env values.

## Key decisions

- **`web` runs in Docker Compose too**, not just `postgres`/`api`/`caddy` as `ARCHITECTURE.md` §12's prose listed. Treating this as filling in an implied detail rather than scope creep: the architecture is explicitly "self-hosted VPS, no BaaS, no Vercel," so the Next.js app has to run _somewhere_, and Docker Compose alongside everything else on the same VPS is the only coherent answer given everything else about this stack. Noted and reflected in `ARCHITECTURE.md` §3/§12 rather than left as a silent mismatch between the docs and what got built.
- **Postgres has no published port.** Only `api` (via the internal Compose network) can reach it. A future need for direct human `psql` access from the VPS host goes through `docker compose exec`, not a port map — smaller attack surface, consistent with `ARCHITECTURE.md`'s general "minimum necessary access" posture applied to infra, not just application code.
- **Migrations run from the `api` container's own entrypoint on every start**, not as a separate manual step or a one-off Compose job. Justified because the migration runner (`src/db/migrate.ts`) is already idempotent by design (checked in M0-006) — safe to repeat, and it means a fresh deploy can never accidentally serve traffic against a stale schema.

## Deviations

The `web` service and the CI `docker-build` job are additions beyond the task's literal one-line description, for the reasons given above — same class of "filling in what 'done' actually requires" as M0-006's CI service-container work, not unrequested scope.

## How this was tested

Locally: `npm run ci` (unaffected — no application code changed, only infra config and one `next.config.ts` line) still passes. The infra config itself has no local test path, per Flag 1 — it's pushed with this report and the new `docker-build` CI job is what actually builds both images and validates the Compose file for real, resolving Flag 2's open question. Per the standing CI rule, this task isn't "done" until that job reports back green and is watched to completion, same as everything else — not assumed done because the Dockerfiles read correctly.

Not testable at all until there's a real VPS, CI or no CI: an actual `docker compose up` with real DNS, Caddy's certificate issuance, and the running containers actually serving traffic end-to-end. That's the next real milestone for this task, once the founder's server access lands.

## Status

Config-as-code written, pushed, pending this session watching the new `docker-build` CI job to completion before this task is marked fully done in `docs/TASKS.md`. Live deployment remains blocked on the founder's Hetzner account regardless of that result.

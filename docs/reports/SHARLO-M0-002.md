# Report: SHARLO-M0-002 — Next.js web app + Fastify api app scaffold

**Status: done.**

## Flags

1. **Structure deviation from `ARCHITECTURE.md` §3's original sketch, corrected in the doc itself.** The architecture doc originally sketched `/app`, `/lib`, `/server` as one folder tree. Once actually scaffolding it, that doesn't match reality: `web` and `api` are separate Docker Compose services with separate release cadence (§12), so they need to be separate deployable packages, not subfolders of one app. Set up as an **npm workspaces monorepo** (`apps/web`, `apps/api`) instead, and updated `ARCHITECTURE.md` §3 to match rather than leaving it stale. This is a structural correction, not a scope change — every module named in the original sketch still exists, just organized as two packages instead of one tree.
2. **The installed Next.js version (16.3.6) is newer than my training data**, and it ships its own `AGENTS.md` explicitly warning about this ("This is NOT the Next.js you know... Read the relevant guide in `node_modules/next/dist/docs/` before writing any code"). Took that seriously rather than assuming pre-16 conventions still apply — read the actual bundled v16 upgrade guide and TypeScript reference before writing app code. Concretely relevant for future work: `middleware.ts`/`export function middleware` is deprecated in favor of `proxy.ts`/`export function proxy` (same purpose — request-time logic before a route resolves, e.g. auth session checks). Whoever builds the M3 auth session-checking logic should use `proxy.ts`, not reflexively write `middleware.ts` from older training knowledge. Also: `next lint` is gone (use `eslint` directly, already set up that way), and `PageProps`/`LayoutProps` are **generated** global types (via `next dev`/`next build`/`next typegen`) — a fresh checkout needs one of those to run before `tsc --noEmit` can resolve them, which is why `web`'s `typecheck` script runs `next typegen` first (see below).

## What was built

- Root `package.json` with `workspaces: ["apps/*"]`, shared `prettier` config (with `prettier-plugin-tailwindcss` for class-order formatting), root scripts (`build`/`lint`/`typecheck`/`test` each fan out across workspaces via `--workspaces --if-present`; `format`/`format:check`; `ci`).
- `apps/web`: Next.js 16 (App Router), React 19.2, TypeScript strict, Tailwind v4, ESLint flat config (`eslint-config-next`). Placeholder home page and metadata replaced with real Sharlo copy (not the Create Next App template content/links) — title, one-line product description, and a note pointing at `docs/TASKS.md` for build status. Removed the unused default template SVG assets.
- `apps/api`: Fastify 5 + TypeScript strict + Zod (installed, not yet used — first real use is M3's request validation), structured per `ARCHITECTURE.md` §5: `src/app.ts` builds the Fastify instance (kept separate from `src/index.ts`'s `listen()` call specifically so tests can use `.inject()` without binding a port), `src/routes/health.ts` is the one route so far — deliberately just a liveness check with a comment warning against wiring in DB/Drive-adjacent state without reconsidering whether it belongs in an always-public route. A `tsconfig.build.json` (extending the base `tsconfig.json`) handles the build-vs-typecheck split needed because `outDir`/`rootDir: "src"` conflicts with also typechecking `test/**` — this is a standard pattern for exactly this situation (also documented in the Next.js TypeScript reference I read for the point above).
- Vitest for `api`'s tests (one real test: `/health` responds 200 without touching DB/auth). `web` doesn't have a test script yet — `--if-present` means the root `test` script skips it cleanly rather than failing; a real component-test setup is later work, not needed to prove this scaffold works.
- `.gitignore` covering `node_modules`, build outputs (`.next`, `dist`, `next-env.d.ts`), env files (except `.env.example`), logs, coverage.

## Key decisions

- **npm workspaces**, not pnpm/turborepo — zero extra tooling beyond what Node already ships, consistent with `ARCHITECTURE.md` §1's "boring technology, few moving parts, solo-founder-operability" priority. Revisit only if build/install times become a real problem at a scale where a dedicated build-orchestration tool (Turborepo, Nx) would pay for its added complexity.
- **Vitest** over Jest for both workspaces (api uses it now; web will when it has component tests) — faster, native ESM/TS support, less config.
- Let `create-next-app` and fresh `npm install` resolve actual current package versions rather than hand-typing version numbers from training knowledge that turned out to already be stale (see Flag 2) — then read what actually got installed before writing code against it.
- Found and fixed 5 dependency vulnerabilities (3 moderate, 1 high, 1 critical) via `npm audit` immediately after install — all in Vitest's dev-only toolchain (vite/esbuild), fixed by upgrading to Vitest 5 (`npm audit fix --force`), verified tests still pass after. Cheap to fix now, before any test suite depends on 4.x-specific behavior; this is the kind of thing NFR-SEC-10 asks CI to catch going forward via Dependabot/Renovate (M0-004, not yet done).

## Deviations

Covered in Flags above (folder structure). No scope deviation — same modules, corrected organization.

## How this was tested

`npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all run and pass for both workspaces individually and via the root `--workspaces` scripts. The built `api` was smoke-tested by actually running `node dist/index.js` and curling `/health`, confirming a real 200 response end-to-end, not just a successful `tsc` compile. The built `web` app's static output was verified via `next build`'s own page-generation report (`/` prerendered as static content).

## Status

Done. `npm run ci` and `npm run build` both green locally (see `docs/reports/SHARLO-M0-003.md` for the CI pipeline that now runs the same checks on every push).

# Report: SHARLO-M0-004 — Dependency pinning & SCA

**Status: done, with one limitation worth naming rather than glossing over.**

## Flags

1. **The task's literal "done when" criterion — "a deliberately outdated/vulnerable test dependency triggers an alert" — can't be demonstrated synchronously in one session.** Dependabot works on its own schedule (weekly, per the config below) plus GitHub's own vulnerability-advisory feed timing; there's no "run it now and see an alert" command to prove it fired. What I can and did verify: the config is syntactically valid and scoped correctly, and I found and evaluated two _real_ dependency advisories by hand this session (`npm audit`, both while building M0-002 and again during M0-006) — which is the same class of thing Dependabot will now do automatically going forward. Treat this task as "the mechanism is in place and correctly configured," not "an alert has been observed firing."

## What was built

- `.github/dependabot.yml`: npm ecosystem scanning the workspace root (which covers `apps/web` and `apps/api` — npm workspaces share one lockfile at the root, so Dependabot's root-directory scan sees the whole dependency graph, not just root-level `devDependencies`), weekly schedule, grouped into a single `npm-dependencies` update group (avoids a flood of one-PR-per-package noise for a solo founder to triage) with a 10-PR-open cap. A second entry covers the `github-actions` ecosystem (the `actions/checkout`, `actions/setup-node` versions pinned in `ci.yml`), also weekly.

## Key decisions

- **Grouped updates** rather than one PR per dependency — for a solo founder without a dedicated platform team, a weekly batch of "here's everything that moved" is more reviewable than a dozen separate PRs for patch bumps. Security-relevant updates still show up the same way; nothing about grouping suppresses or delays an advisory, it just batches routine version bumps together.
- **Weekly**, not daily — matches the cadence a solo founder can actually keep up with reviewing; GitHub's own security-advisory alerts (separate from Dependabot's scheduled version-update PRs) still fire immediately regardless of this schedule for anything already known-vulnerable at time of publish.
- Did not add Renovate as an alternative/addition — Dependabot is native to GitHub (zero extra account/app to configure) and sufficient at this scale; Renovate's extra configurability isn't buying anything this project needs yet.

## Deviations

None from the task description. The "done when" limitation above is a property of what's actually verifiable synchronously, not a deviation in what was built.

## How this was tested

Validated the YAML is well-formed and matches Dependabot's documented schema (ecosystem names, directory, schedule interval, grouping syntax). The real-world proof-of-concept for _why_ this matters happened organically this session: `npm audit` caught 5 real vulnerabilities in Vitest's dev-only toolchain during M0-002 (fixed via upgrade) and flagged 4 more in drizzle-kit's legacy esbuild chain during M0-006 (evaluated and deliberately left as a monitored, low-practical-risk dev-tool-only advisory rather than force-downgrading into a regression — see `docs/reports/SHARLO-M0-006.md`). Dependabot now does that same kind of check on a standing schedule instead of only when a human happens to run `npm audit`.

## Status

Done. First real Dependabot activity (if any) will show up as PRs against `main` on its own schedule — nothing further to do here now.

# Report: SHARLO-M0-003 — CI pipeline

**Status: done, with one piece that needs the founder specifically.**

## Flags

1. **Branch protection on `main` is a GitHub repository-admin setting, not something committed in code — a Claude Code session doesn't have (and shouldn't be given) the access to flip it.** The kickoff prompt says "`main` branch is protected," and `CLAUDE.md` restates it as a standing rule this session already follows (all work on feature branches/PRs). But the actual GitHub setting ("require status checks to pass before merging," naming the new `CI` check) needs a repo owner to turn on in Settings → Branches. Flagging rather than silently claiming this is fully done: **the workflow that makes it enforceable now exists and is green; the enforcement switch itself is a one-time manual step for you.** Repo: `thegreatmoneyjourney-jpg/Sharlo-` → Settings → Branches → add a protection rule for `main` requiring the `CI / Lint, typecheck, test` check.
2. **`npm audit fix --force` was run during this work** (see `docs/reports/SHARLO-M0-002.md`) — flagging here too since it's exactly the kind of dependency change CI should be the safety net for: I verified tests still passed after the forced upgrade rather than trusting the audit fix blindly.

## What was built

- `.github/workflows/ci.yml`: runs on every push to `main` and every PR. Steps: checkout, Node 22 setup with npm cache, `npm ci` (not `npm install` — CI should install exactly what the lockfile says, never resolve fresh versions), `npm run ci` (format check + lint + typecheck + test across both workspaces), then `npm run build` as a separate step so a build-only failure is distinguishable in the Actions log from a lint/test failure.
- Root `npm run ci` script (`package.json`): `format:check && lint && typecheck && test`, in that order — fails fast on the cheapest check first rather than running expensive typecheck/test passes before discovering a formatting issue.
- README updated with the exact commands (`npm run ci`, `npm run build`) so running "the same checks CI runs" is a copy-pasteable, not aspirational, instruction — this was previously a placeholder saying "not yet set up."

## Key decisions

- CI runs `npm run build` as a **separate** step from `npm run ci`, even though the root `build` script could have been folded into the `ci` script. Reasoning: build failures and lint/test failures are different categories of problem (the former often means a dependency/config issue, the latter means a code issue) and keeping them as separate Actions steps makes the failure log easier to scan at a glance — a small UX choice for whoever's debugging a red CI run at 11pm, which given the solo-founder context in `ARCHITECTURE.md` §1 is a real scenario worth optimizing for.
- Did **not** add the OAuth-scope CI guard (`docs/TASKS.md` M3-011) yet, even though `ARCHITECTURE.md` NFR-SEC-03 calls for one — there's no OAuth code anywhere in the repo yet for it to check, so a step referencing a not-yet-written guard script would just break CI with nothing real to verify. It belongs with M3's actual OAuth work, not bolted onto this scaffold speculatively. (I did initially draft it into `ci.yml` and then pulled it back out for this reason — worth recording so a future session doesn't wonder why NFR-SEC-03 isn't wired up yet: it's sequencing, not an oversight.)

## Deviations

None from the task's description. The branch-protection flag above is a limitation of what this session can do, not a deviation in what was built.

## How this was tested

Ran the exact workflow steps locally in the order the YAML specifies (`npm ci` equivalent already satisfied since `npm install` had just run; `npm run ci`; `npm run build`) and confirmed all green before writing the workflow file — per `CLAUDE.md`'s rule to run CI's checks locally before relying on them. The workflow YAML itself will get its first real remote run on the next push to this branch/PR, which this session will watch per the standing CI rules.

## Status

Done, pending the one manual branch-protection step above. `docs/TASKS.md` M0-002 and M0-003 both marked done.

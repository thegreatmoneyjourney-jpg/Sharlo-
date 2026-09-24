# CI Audit — all PRs merged to `main` to date (2026-09-24)

Requested by the founder alongside the new standing CI rule in `CLAUDE.md` ("CI / workflow rules" → "Standing rule: all CI checks green, no exceptions"). This is the first audit under that rule; pulled directly from GitHub's check-run API at audit time, not from memory or from this session's earlier summaries.

## PR #1 — "Foundational planning docs: SRS, architecture, ADRs, tasks"

**`get_check_runs` result: `total_count: 0`.**

This is not "green" — there was **no CI to be green against**. `.github/workflows/ci.yml` didn't exist yet; it was added in PR #2. PR #1 was docs-only (SRS, architecture, ADRs, task breakdown, no application code), so there was nothing a CI pipeline would have exercised even if one had existed. Stating this precisely rather than rounding it up to "passed": zero checks ran, zero checks could have failed, and that's a different thing from zero checks failing out of some that ran. If you want retroactive coverage here, the only thing that would have applied is a docs-only check (markdown lint / link-checking) — I haven't built one; say the word if you want it added, since it wasn't in scope for M0-001 and I don't want to add it unprompted given item 5 in your message (hold on new work until M1 go-ahead) probably extends to "don't add new CI surface unprompted" too.

## PR #2 — "Scaffold Next.js + Fastify monorepo with working CI (M0-002, M0-003)"

**`get_check_runs` result: 1 check, `Lint, typecheck, test` → `completed` / `success`.**

Single attempt, clean. This PR is the one that added `ci.yml` in the first place, so it's also the first commit in the repo's history that a CI check could run against at all — and it passed on the first try. Nothing to flag.

## PR #3 — "Postgres RLS multi-tenant proof + Dependabot (M0-004, M0-006)"

**`get_check_runs` (current head commit `a436cb1`): 1 check, `Lint, typecheck, test` → `completed` / `success`.** The state this PR was merged on was fully green — same bar as PR #2.

**But the full picture, since you asked for a precise audit and this matters:** this PR has two commits, not one. The first (`f7450e3`) ran CI and it **failed** — a real bug (see `docs/reports/SHARLO-M0-006.md`: a Postgres RLS policy that assumed a custom session setting always reads back as `NULL` when unset, which is false on a _pooled_ connection that had previously touched that setting — it comes back as an empty string instead, and casting that straight to `::uuid` threw instead of denying). This was not flaky — it failed the same way every time for a real, understood reason, not intermittently for an unrelated one. I read the failure, identified the actual root cause, fixed the policy itself (not the test), pushed a second commit (`a436cb1`), and only merged once _that_ commit's checks came back green. GitHub's `get_check_runs` only surfaces the head commit by default, which is why this needed the commit-by-commit look to surface at all — worth knowing for how you read future audits like this one, since "green PR" from a single API call can hide exactly this kind of history if nobody looks closer.

**My read of your new standing rule against this specific case:** "no work proceeds past a PR unless all CI checks on it are green" — I'm treating this as being about the state you _act on_ (merge, or move to the next task), not a demand that a PR's history contain zero red commits ever. Diagnosing a real failure and fixing it before merging is what "investigate why it's flaky and fix the root cause" describes, applied to a non-flaky failure — the same discipline, not an exception to it. What I did _not_ do: merge while a check was still red, retry the identical commit hoping for a different outcome, or waive/skip the failing assertion. If your intent is stricter than that — e.g., a red commit anywhere in a PR's history should mean closing that PR and opening a fresh one for the fix, even pre-merge — tell me and I'll adopt that going forward; I don't think that's what the rule says, but I'd rather confirm than assume on something you just made a standing project rule.

## Not part of "merged to `main`," flagging anyway since it's directly relevant to this audit

Dependabot (M0-004, working as designed) has already opened three PRs against `main`, all still open and unmerged: **#4** (`actions/setup-node` 4→7), **#5** (`actions/checkout` 4→7), **#6** (9 grouped npm dependency updates). I haven't touched these — they weren't part of what you asked me to audit (which was PRs already merged), and per your item 5 I'm holding off on anything beyond the four things you asked for this round. Flagging their existence now so it's not a surprise; say if you want me to evaluate/merge them (the two GitHub Actions bumps jump 3 major versions each and are worth an actual look before merging, not a rubber stamp) or leave them for later.

## Summary

| PR  | Merged state                                              | Clean single attempt?                                                               |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| #1  | No CI existed at the time — not applicable, not "passing" | N/A                                                                                 |
| #2  | Green, 1/1 checks                                         | Yes                                                                                 |
| #3  | Green, 1/1 checks, on the commit it was merged on         | No — 1 real failure, root-caused, fixed, re-verified green before merge (see above) |

No waived checks, no skipped checks, no merges on red, in any of the three. The one PR with a real failure is documented, not hidden, and I've flagged my interpretation of the new rule against it explicitly for you to confirm or correct.

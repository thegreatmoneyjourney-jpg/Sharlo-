# Task workflow — the mandatory sequence for every task, no steps skipped

This is referenced from `.clinerules` as the literal procedure to follow for every single task in `docs/TASKS.md`. Follow these 14 steps in order, every time, whether the task feels large or small. "I skipped step 4 because this change was tiny" is not an acceptable reason for step 4 to be missing — if a step genuinely doesn't apply (e.g., step 2 when the task cites no ADR), say so explicitly in the task's report rather than silently passing over it.

---

## 1. Read the task's full spec before writing any code

Open `docs/TASKS.md`, find the task, and read all five fields: **Goal**, **Done-when**, **Must-reuse / must-not-duplicate**, **Test requirements**, and **task-specific stop-and-ask triggers**. Not just the title. Not just the Goal. All five.

## 2. If the task touches an existing ADR's subject matter, read that ADR in full first

Check the task's "Requirement(s)" column/field for an ADR reference, and check whether the area of code you're touching has an ADR in `docs/ADR/` even if the task doesn't cite one directly (e.g., anything touching Drive storage should make you check `ADR-0004`; anything touching encryption should make you check `ADR-0005`). Read the whole file, including any addendum section at the bottom — addenda often contain the actual current behavior, with the original "Decision" section partially superseded.

## 3. Implement the change

Build exactly what the task's Goal and Done-when criteria describe. If you find yourself building something the task didn't ask for "while you're in there," stop and either fold it into a stop-and-ask (if it's scope-expanding) or leave it for a separate task (if it's genuinely out of scope for this one).

## 4. Write or update tests matching the task's stated test requirements

Not just "some tests" — the specific kind of test the task's own Test Requirements field calls for (unit / integration against real local Postgres / real-browser Playwright / manual verification with a written note). If the task calls for a real-browser check and you only ran a mocked unit test, the task is not done — see `HANDOFF.md` §5.6.

## 5. Run the full local CI-equivalent command and confirm it passes, locally, before committing

This repo's command is `npm run ci` (format check + lint + typecheck + test) at the repo root. Run it. Read the output. Confirm it actually says everything passed — don't glance at the last line and assume. Never commit or push on the assumption it will probably pass.

## 6. Make an atomic commit

One logical change per commit. No half-finished state — a migration with no code that uses it yet, a component split across commits where the first commit alone breaks the build, etc. If the change is genuinely too large for one commit, every individual commit in the sequence must leave the repo working and `npm run ci`-passing on its own.

## 7. Push, then explicitly verify the push landed

```
git push -u origin <branch-name>
git fetch origin <branch-name>
git rev-parse HEAD
git rev-parse origin/<branch-name>
```

The last two commands must print the identical SHA. If they don't, the push did not land the way you think it did — investigate before doing anything else. Never infer success just because `git push` didn't print an error.

## 8. Open the PR

Write a title and description that explain what changed and why, following any existing PR template the repo has. Reference the task ID from `docs/TASKS.md`.

## 9. Wait for CI; check actual CI results via real check-run data

Use the GitHub API/CLI tooling available to you to read the actual check-run status on the PR's current head commit. Do not treat "I haven't heard anything" as success. Do not treat a vague notification as proof of a specific result — read the actual pass/fail state of each named check.

## 10. Before merging, confirm all three of these, explicitly

1. Every check on the current head commit is green — all of them, not most.
2. No review thread is unresolved.
3. The PR's mergeable state is clean (no merge conflict with the base branch).

If any of the three isn't true, the PR is not ready to merge, no matter how close it looks.

## 11. Merge, then restart the local branch from the new `main`

```
git fetch origin main
git checkout -B <branch-name> origin/main
```

Do this before starting the next task, so you're never building on top of a branch that's drifted from `main`.

## 12. Write the task's report

One file at `docs/reports/<task-id>.md`, in this exact order:

1. **Flags** (if any) — anything blocked, ambiguous, or deviating from the task's description, and why. If there's genuinely nothing to flag, say "Nothing to flag" explicitly — don't just omit the section.
2. What was built.
3. Key decisions made along the way.
4. Deviations from the original task description, and why.
5. How it was tested.
6. Current status: done / blocked / partial-and-why.

## 13. Update the task's status in `docs/TASKS.md`

Mark it done (with a link to its report), or blocked (with the specific reason), directly in the task's own row/entry.

## 14. Only then move to the next task

And only if that next task is within an already-authorized milestone. If it's the first task of a milestone that hasn't been explicitly authorized by the founder, stop — see `.clinerules` §2, the milestone-gating rule. This is true no matter how obviously "next" the new milestone looks.

---

**One more thing that isn't a numbered step because it applies throughout, not at one point:** if at any point during steps 1–14 you hit one of the situations in `.clinerules` §6 (the stop-and-ask list), stop at that exact point, don't continue to the next step, and ask. Finishing the remaining steps on a task you're genuinely unsure about doesn't make the uncertainty go away — it just means more gets built on an unconfirmed foundation.

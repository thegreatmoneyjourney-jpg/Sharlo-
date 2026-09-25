# Report: SHARLO-M1-009 — Roll-number grid reading

**Status: implementation complete, verified (unit tests), merged to `main` (PR #27, commit `7c8cb50`).**

---

## 🚩 Flags — read this section first

Nothing blocked or ambiguous. One methodology point worth flagging explicitly rather than leaving implicit:

**No real-browser verification was performed for this task, and that is itself worth explaining rather than just noting as an omission.** Every M1 task from M1-003 through M1-008 needed real-browser (Playwright) verification because each one touched something a real browser actually has to execute — OpenCV WASM, canvas pixel rendering, Web Audio, `<video>` decoding — none of which jsdom can do correctly. `roll-number.ts` touches none of that: it's plain TypeScript operating on `QuestionResult` values and a `Set<string>`, both of which behave identically in jsdom and a real browser because there's no browser-specific API involved at all. Running the same Playwright-based verification here would have re-executed logic unit tests already cover, against the same JS engine, proving nothing a unit test hadn't already proven. Flagging this so a future reader doesn't read the absence of a real-browser check as a gap consistent with this milestone's other, genuine device/browser-testing gaps (M1-002, M1-004, M1-007, M1-008) — it isn't; it's a different, structural reason.

---

## What was built

- **`apps/web/lib/scanning/roll-number.ts`**:
  - `readRollNumber(columnResults)` — combines one `classifyQuestion()` result (from `bubble-fill.ts`, M1-006) per digit column into a roll-number string. A digit column is exactly a 10-option question in `classifyQuestion`'s terms, so this reuses that function directly rather than re-implementing bubble classification for digits. Unlike an answer question, where `'blank'` is a legitimate, common, non-flagged outcome (a skipped question), a roll number has no legitimate blank digit — every column of a genuinely-filled-in roll number has exactly one mark — so both `'blank'` and `'flagged'` column outcomes here make the _whole_ roll number `'unreadable'`. There is no code path in this function that returns a partial or guessed digit string.
  - `matchRollNumber(read, roster)` — checks a `readRollNumber` result against `roster: ReadonlySet<string>` and returns `'matched' | 'unread' | 'unmatched'`. `roster` is deliberately just a set of valid roll-number strings, not a full student-record schema — no roster/class-list data model exists yet in this codebase (that's a later milestone's concern), and this function only ever needs membership. Every non-`'matched'` outcome is FR-DETECT-04's "route to Review Queue" signal — the type system makes it impossible for a caller to mistake `'unread'`/`'unmatched'` for a silent success.
- **Tests**: `roll-number.test.ts` — 13 tests: `readRollNumber`'s correct-combination, leading-zero-preservation, single-column, and empty-list cases, plus the blank/flagged-makes-it-unreadable cases; `matchRollNumber`'s matched/unread/unmatched cases, plus a dedicated **"never silently discards"** parameterized suite (mirroring `bubble-fill.test.ts`'s "never guesses" suite) covering unreadable input, a roll number not on the roster, an empty-string read, and a roster-prefix near-miss — none of which ever produce `'matched'`.

## Key decisions

### 1. Reusing `classifyQuestion` instead of writing digit-specific classification

A digit column (10 bubbles, one per digit 0-9) and an answer-question's option group (however many bubbles) are the same shape from the classifier's point of view: a set of fill ratios, exactly one of which should be confidently filled for a confident result. `classifyQuestion` doesn't know or care what the options _mean_ — it already handles "exactly one confident, rest empty," "multiple confident," "any ambiguous," and "all empty" correctly and is already covered by its own thorough test suite (including real-rendered-pixel verification from M1-006). Re-deriving the same logic under a different name for digits specifically would be pure duplication with no behavioral difference, and a second place for the same class of bug to be reintroduced.

### 2. `blank` and `flagged` are both `unreadable` here, even though M1-006 treats them very differently

This is the one place this task's semantics genuinely diverge from `classifyQuestion`'s own question-level meaning, and it's a deliberate, direct consequence of what a roll number actually is: a fixed-width identifier where every position is expected to be marked, not an optional answer. Collapsing `blank` into the same `unreadable` bucket as `flagged` (rather than, say, treating a blank column as "digit unknown, fill with a placeholder") is what makes FR-DETECT-04's "never silently discarded" guarantee hold for the whole roll number, not just for individually-ambiguous digits.

### 3. Roster as `Set<string>`, not a richer type

Keeping `matchRollNumber`'s second parameter as the narrowest useful type (a set of valid strings) rather than guessing at a `Student { rollNumber, name, ... }` shape avoids inventing a data model that a later milestone (wherever roster upload/class-list management actually gets built) would either have to conform to retroactively or replace outright. The function's actual job — "is this string a valid roll number" — doesn't need anything richer than that.

## Deviations from the task description

None.

## How this was tested

- **`npm run ci`** (format, lint, typecheck, test) — green at repo root. 111/111 tests passing in the `web` workspace (up from 98).
- **No real-browser verification** — see Flag above for why that's correct for this task rather than an omission.

## Current status

Done. Merged to `main` via PR #27 (merge commit `7c8cb50`), head commit `0764020` verified green on both CI jobs before merging (this run, like the previous few, was noticeably slower step-by-step than earlier in the session — confirmed genuine progress via job step timestamps each time rather than a stuck run, not investigated further since every step did complete successfully). Branch `claude/optimistic-allen-9ljry1` restarted from `main` post-merge and push verified landed (`git fetch` + SHA comparison).

Next: M1-010 (detection engine unit test harness) — the last M1 task, and the one that formalizes the "reusable fixture-based test harness" gap flagged repeatedly across M1-003 through M1-006's reports.

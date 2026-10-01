# SHARLO-M3-010 — Export: Excel/CSV

**Status: done.** Builds `FR-RESULTS-04` on the `ADR-0013` formula-injection-sanitization decision, using the already-decrypted `ExamResults` data `M3-008`/`M3-009` established.

## Flags

1. **A new runtime dependency (`exceljs`) pulled in a transitive CVE (`uuid < 11.1.1`), fixed via an `overrides` entry rather than a version downgrade — and the process of applying that override surfaced a real risk worth flagging explicitly.** `npm audit` reported the CVE immediately after adding `exceljs@4.4.0`. `npm audit fix --force`'s own suggested fix was to downgrade to `exceljs@3.4.0`, which would have reintroduced a real prototype-pollution CVE that `4.4.0` was specifically chosen to avoid — rejected. Verified the CVE doesn't actually apply to how `exceljs` uses `uuid` (only `v4()`, never the buffer-accepting `v3/v5/v6` the advisory is about) before deciding an override was safe, not just applying it on the vulnerability-scanner's say-so. The override itself needed `npm update uuid` to actually take effect — a plain `npm install` reported "up to date" despite the override being unmet, and reaching for a full lockfile regeneration (delete `package-lock.json`, fresh install) as the next attempt **silently drifted ~20 unrelated transitive packages** (`vitest`, `typescript-eslint`, `sharp`, `rolldown`, and others — a few of them even downgraded) to whatever the registry currently serves, none of it related to this task. Caught by diffing every package's resolved version against the pre-change lockfile before accepting any dependency change — not by trusting that the audit count went down. Reverted that regen and used `npm update uuid` instead, which changed exactly the one package. Flagged here because this is a real process risk worth a future session knowing about, not because the final state is in question — see Key Decisions and `CLAUDE.md`'s new bullet.
2. **A one-off `apps/api` test failure during final CI verification (`auth-routes.test.ts`, "rejects a callback whose state does not match the signed cookie") was investigated, not dismissed as a flake, and found non-reproducible.** The failing assertion was on the very first call in that test (`/auth/google/start` returning 500 instead of 302) — a route neither this task nor any of its commits touches (this task has zero `apps/api` changes). Investigated the one concrete shared-state mechanism that route depends on (`integration_credentials`'s `google_oauth`/`client_id` row, read by `getCredential`, written by three different test files' own `setCredential` calls): the table has a proper unique index on `(provider, keyName)` and `setCredential` is a real upsert (`onConflictDoUpdate`), so concurrent test files racing on it can only ever race on _which value_ is current, never corrupt the row or cause a read failure; confirmed no test file anywhere does an unscoped `DELETE`/`TRUNCATE` on that table's `google_oauth` rows either. The specific test file passes cleanly in isolation, and the full `apps/api` suite passed cleanly in 6 consecutive full-suite re-runs after the one failure, including the final run this report's "how it was tested" section cites. Treated as a transient environmental blip in a long-running sandbox session (not a reproducible defect in the code), but recorded here rather than silently re-run past, per this project's standing discipline.
3. **Not verified against a real class-sized exam or a real device** — the same category of gap `M1-011`, `M3-001`, `M3-006`/`M3-007`, `M3-008`, and `M3-009` already carry. What _is_ newly verified here, specifically because this task introduces a new binary-file-producing dependency: `exceljs`'s `writeBuffer()` output was run against a real Chromium instance (a throwaway esbuild-bundled page built and torn down during this task, not committed to the repo), not just Node/vitest — producing a genuine, well-formed `.xlsx` (confirmed by its ZIP magic-number signature) with no Node-only API dependency in the path actually exercised. This is the same real-browser discipline `M2-009`'s pdfjs-dist bug established, applied here because this Next.js version is explicitly flagged (`apps/web/AGENTS.md`) as unfamiliar territory not safely assumed from training data.

## What was built

**`apps/web/lib/export/` (new directory) — the generic, reusable half:**

- `sanitize.ts` — `sanitizeCellValue`, the one `ADR-0013` utility: prefixes a string starting with `= + - @` with a single apostrophe, naturally idempotent, never applied to numeric values.
- `csv-writer.ts` — `buildCsv(headers, rows)`, a generic RFC4180-ish CSV builder (CRLF line endings, minimal quoting) operating on typed `CsvCell` values (`'string'` cells sanitized, `'number'` cells written plain) so a number can never accidentally go through the sanitizer.
- `download-file.ts` — `downloadBlob(blob, filename)`, the standard object-URL-plus-temporary-anchor-click browser download pattern, generic and reusable for any future export.

**`apps/web/lib/exams/` (modified/new) — the exam-shaped half:**

- `outcome-labels.ts` (new) — `OUTCOME_LABELS`, extracted from `results-grid.tsx` so both the UI and the export module show identical wording for a given outcome; `results-grid.tsx` now imports it instead of defining its own copy.
- `exam-export.ts` (new) — `buildExamExportRows` (the one row-building step both formats share: name, roll number, per-question outcome label, correct count, graded count), `examResultsToCsv`, `examResultsToXlsxBuffer` (via `exceljs`), `safeExportFilename`. Roll number is a string cell in both formats on purpose — a native numeric cell would silently drop a zero-padded roll number's leading zero (`M3-007`).

**`apps/web/app/(app)/exams/[id]/exam-results-client.tsx` (modified):** a new `ExportButtons` component ("Download CSV" / "Download Excel", the Excel one showing a disabled "Preparing…" state while `writeBuffer` runs) rendered between the editable grid and the per-question breakdown.

**Dependency changes:** `exceljs@4.4.0` added to `apps/web/package.json` (exact pin, matching this repo's existing convention for `pdfjs-dist`/`pdf-lib`); a new root-level `package.json` `"overrides": { "uuid": "^11.1.1" }` — see Flag 1.

## Key decisions

- **`exceljs` over the more commonly-reached-for `xlsx`/SheetJS package** — actively maintained, pinned at exactly the version (`4.4.0`) that fixes a real prototype-pollution CVE present in earlier 4.x releases.
- **The `uuid` CVE is fixed by overriding the transitive version, not by downgrading `exceljs`** — confirmed safe first (the vulnerable `v3/v5/v6`-with-buffer code path is never reached; `exceljs` only calls `v4()`), applied via `npm update uuid` after a plain `npm install` failed to pick up the new `overrides` entry — see Flag 1 for the full sequence, including the regen attempt that was tried and reverted for drifting unrelated packages.
- **Roll number is always a string cell, in both CSV and XLSX** — identifier data with meaningful leading zeros, never a quantity; this is a correctness requirement (`M3-007`), not just an `ADR-0013` technicality.
- **The "Correct"/"Graded" tally is written as two real numeric columns, not a single "X / Y" string** — lets a teacher use the exported numbers directly in spreadsheet formulas, and keeps the numeric/string column distinction `ADR-0013` itself draws.
- **The sanitize utility, CSV writer, and `download-file.ts` helper are all generic on purpose** — `M11`'s import path and any future export path are expected to call these exact functions, not recreate them, matching `ADR-0013`'s own explicit "one shared utility" requirement.

## Deviations from the original task description

None against `M3-010`'s own row (`docs/TASKS.md`: "Export functionality using the shared sanitization utility from `ADR-0013`... Free tier's export path is CSV/Excel only," done-when "exports as a literal string, not a formula, when opened in Excel — via the shared utility"). The `uuid`-override dependency work (Flag 1) is the unavoidable consequence of the task's own "use `exceljs`" implementation choice, not scope added independently of it.

## How it was tested

- **`lib/export/sanitize.test.ts`**: every flagged leading character, a sample of ordinary values (including one starting with an apostrophe already), idempotency.
- **`lib/export/csv-writer.test.ts`**: header/row join with CRLF, sanitization applied only to string cells, correct quoting of commas/quotes/newlines, a full round-trip through `lib/roster/parse-csv.ts` confirming the writer and the pre-existing parser agree.
- **`lib/exams/exam-export.test.ts`**: `buildExamExportRows`'s mapping (including the excluded-question-doesn't-count-toward-graded case and the null-name/roll-number fallback), `examResultsToCsv`'s header/data shape and sanitization-vs-numeric-columns behavior parsed back via `parseCsv`, `examResultsToXlsxBuffer` round-tripped through a real `exceljs` load — asserting actual cell **types** (`ExcelJS.ValueType.String` vs `.Number`), not just values, specifically to catch a roll number silently becoming numeric; a worksheet-name-sanitization case.
- **`app/(app)/exams/[id]/exam-results-client.test.tsx`**: two new tests (`downloadBlob` mocked) asserting the CSV button builds a `text/csv` blob with the right filename and content, and the Excel button shows the busy state, builds the right MIME-typed blob, and re-enables afterward.
- **Real-Chromium verification of `exceljs`'s `writeBuffer`** — see Flag 2.
- **Full-suite regression + `npm run ci`**: both workspaces green against real Postgres (format:check, lint, typecheck, test — 128/128 API, 564/564 web).

## Current status

Done, with Flag 1's dependency-override process and Flag 2's real-browser verification both explicitly recorded rather than glossed over.

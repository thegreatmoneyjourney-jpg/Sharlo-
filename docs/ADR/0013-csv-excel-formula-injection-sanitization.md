# ADR-0013: CSV/Excel formula-injection sanitization — exact technique, applied universally

**Status:** Accepted

## Context

`NFR-SEC-06` has said since the original SRS that exports sanitize cells starting with `= + - @` to prevent formula-injection (a cell like `=1+1`, or worse, `=IMPORTXML(...)`/`=HYPERLINK(...)`-style payloads, executing as a live formula when the file is opened in Excel/Sheets rather than being treated as inert text). Addendum 2's manual-import feature (`FR-IMPORT-*`) makes this a two-directional problem for the first time — a malicious value can now arrive _from_ an imported file, not just leave through an export — and `FR-IMPORT-08` explicitly asks for one consistent technique applied everywhere, not a rule restated per-feature. This ADR is that one technique, specified precisely enough that a future implementation can't quietly drift from it.

## Decision

**Technique:** for any cell whose value is a **string** and begins with `=`, `+`, `-`, or `@`, prefix it with a single leading apostrophe (`'`) before writing it to a CSV or Excel file. This is the standard, universally-supported "force text" prefix both Excel and Google Sheets already recognize — it doesn't appear in the displayed value, it isn't itself a character that needs further escaping, and it requires no per-application special-casing.

**Applies to:**

- Every export path in the app (`FR-RESULTS-04` and beyond) — not just new ones.
- Every import path (`FR-IMPORT-01`) — a value read _from_ an untrusted file must be sanitized the same way before it's ever re-exported or re-displayed anywhere a formula-capable viewer might later open it, since import and export are two ends of the same round-trip risk.

**Does not apply to genuinely numeric fields** (marks, totals, scores): these are written using the export library's native numeric cell type, never as a string, so the entire leading-character risk category doesn't apply to them in the first place — sanitizing a number-typed cell is a symptom of a deeper bug (a numeric value stored as a string somewhere upstream), not something this rule should paper over. Only string-typed columns (name, roll number if alphanumeric, any free-text field) go through the prefix check.

## Alternatives considered

- **Strip the leading character instead of prefixing.** Rejected — silently drops user-entered data (a legitimate roll number or name starting with one of those characters, however rare, becomes wrong data, not just safely-displayed data). Prefixing preserves the original value exactly; stripping doesn't.
- **Wrap the value in an explicit text formula, e.g. `="value"`.** Rejected — this is itself a formula and doesn't neutralize the injection risk at all if the _inner_ value is attacker-controlled; it also doesn't display as plain text the way a `'`-prefixed cell does.
- **Reject/error on import for any cell starting with these characters, rather than sanitize.** Considered for the import direction specifically. Rejected as the default: it would flag a lot of entirely benign data (a name field is unlikely to start with these characters, but a free-text note or an id-like string plausibly could) and doesn't match how `FR-IMPORT-03`'s validation model already works — validation surfaces _data quality_ problems (missing roll numbers, mismatched counts) for the teacher to look at, whereas formula-injection sanitization is a silent, safe, non-blocking transformation, since there's no legitimate reason a `'`-prefix would ever need teacher review. Keeping these as two different mechanisms (silent sanitization vs. surfaced validation) matches what each one actually is.
- **Extend the character list beyond `= + - @`** (OWASP's own CSV-injection guidance also flags a leading tab (`0x09`) and carriage return (`0x0D`) in some contexts). Not adopted here — the founder's specification names exactly `= + - @`, and widening it wasn't asked for. Noted for the record as a real, low-cost hardening available later if wanted; flagged rather than silently added, since NFR-SEC-06/FR-IMPORT-08 are precise about the character set and this ADR shouldn't quietly exceed what was specified.

## Consequences

- One shared sanitization utility function, used by every import and export code path — not reimplemented per-feature. A future export or import feature that skips it is a bug in that feature, not a gap in the rule.
- Round-tripping a sanitized value through import → display → export stays stable (the prefix is idempotent-safe: re-sanitizing an already-prefixed value doesn't double-prefix it, since the check is on the _original_ first character, applied once at the boundary, not re-applied on every re-save).
- Testing this is cheap and concrete: a fixture file with a `=`-leading cell in each affected column, asserting the exported/re-imported value is the literal string, not a formula, in every path that touches student-facing tabular data.

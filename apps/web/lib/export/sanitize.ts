const FORMULA_INJECTION_LEADING_CHARS = new Set(['=', '+', '-', '@']);

/**
 * `ADR-0013`: for any **string** cell value beginning with `= + - @`,
 * prefix it with a single leading apostrophe before writing it to a
 * CSV/Excel file — the standard, universally-recognized "force text"
 * prefix, so the value can never be interpreted as a live formula when
 * the file is later opened in Excel/Google Sheets. The one shared
 * utility every import and export path in the app reuses — never
 * reimplemented per-feature (`ADR-0013`'s own "Consequences" section).
 *
 * Naturally idempotent: the check is only ever on the value's *original*
 * first character, so re-sanitizing an already-prefixed value (now
 * starting with `'`, which isn't itself in the flagged set) never
 * double-prefixes it.
 *
 * Never call this on a genuinely numeric field (a mark, total, or
 * score) — those are written using the export library's own native
 * numeric cell type, never as a string, so the entire leading-character
 * risk category doesn't apply to them in the first place. Only
 * string-typed columns (name, roll number, any free-text field) go
 * through this check.
 */
export function sanitizeCellValue(value: string): string {
  return FORMULA_INJECTION_LEADING_CHARS.has(value.charAt(0)) ? `'${value}` : value;
}

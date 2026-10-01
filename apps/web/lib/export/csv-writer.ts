import { sanitizeCellValue } from './sanitize';

/**
 * A typed cell for `buildCsv`. `'number'` cells are written as plain
 * digits, never run through `sanitizeCellValue` — per `ADR-0013`, the
 * formula-injection risk doesn't apply to a genuinely numeric field in
 * the first place. `'string'` cells always go through it.
 */
export type CsvCell = { type: 'string'; value: string } | { type: 'number'; value: number };

function escapeCsvField(raw: string): string {
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function formatCell(cell: CsvCell): string {
  return cell.type === 'number'
    ? String(cell.value)
    : escapeCsvField(sanitizeCellValue(cell.value));
}

/**
 * Builds an RFC4180-ish CSV string (CRLF line endings, matching Excel's
 * own CSV export) — the generic, reusable half of the export path every
 * future tabular export reuses, same as `lib/roster/parse-csv.ts` is the
 * generic reusable half of every tabular *import*. Headers are escaped
 * but never sanitized — they're app-controlled constants, not
 * user-entered data, so the formula-injection risk doesn't apply to them.
 */
export function buildCsv(headers: readonly string[], rows: readonly CsvCell[][]): string {
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(row.map(formatCell).join(','));
  }
  return lines.join('\r\n');
}

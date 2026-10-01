/**
 * Minimal RFC4180-ish CSV tokenizer: quoted fields (commas/newlines inside
 * a quoted field, `""` as an escaped literal quote), CRLF or LF line
 * endings, a leading UTF-8 BOM stripped (Excel's CSV export adds one),
 * and blank lines skipped anywhere in the file (not just a trailing one —
 * a common artifact of hand-edited or Excel-exported CSVs, never
 * meaningful roster data). Hand-rolled rather than a dependency: the only
 * thing genuinely needed here is correct quote handling, which is a small
 * amount of code on its own.
 *
 * Deliberately just text -> rows of raw strings — no header detection, no
 * column interpretation. That's `roster.ts`'s job, the same layering
 * `lib/scanning/` already uses (`bubble-fill.ts` samples pixels,
 * `roll-number.ts` interprets columns as digits; neither knows about the
 * other's concern).
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  function endField() {
    row.push(field);
    field = '';
  }
  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  while (i < source.length) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ',') {
      endField();
      i++;
      continue;
    }
    if (char === '\r') {
      endRow();
      i += source[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ''));
}

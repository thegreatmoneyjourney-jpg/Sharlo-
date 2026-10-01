/**
 * `M3-007` (`FR-ROSTER-01`, `FR-ROSTER-02`) — the roster data model and
 * the roll-number-matching integration point `lib/scanning/roll-number.ts`
 * (`M1-009`) and `lib/scanning/review-queue.ts` (`M2-006`) both explicitly
 * deferred to "a later milestone" that builds a real class-list model.
 * This is that milestone.
 *
 * **Same underlying record as the future Class Management feature
 * (`M8-001`), not a parallel one** — `docs/SRS.md`'s `FR-ATTEND-02` is
 * explicit: "this roster is the _same_ underlying record `FR-ROSTER-01`'s
 * per-exam CSV upload populates... not two parallel student lists." The
 * Free/Pro/School feature-gating table's "the ad-hoc, per-exam roster —
 * not the same as Class Management below" is about which *feature
 * surface* a tier gets (Free: CSV-upload-per-class only; Pro/School:
 * also the fuller Class Management UI `M8` will add), not the data
 * model — `M8-001`'s own row confirms this reading directly ("the same
 * underlying record... not a parallel list"). So a `Roster` here is
 * already keyed by class (`recordId`, `className`), reusable across
 * exams for that class, exactly as `FR-ROSTER-01` states — not a
 * disposable per-exam-only list that `M8` would later have to migrate
 * away from.
 */

import { parseCsv } from './parse-csv';
import { matchRollNumber } from '../scanning/roll-number';
import type { RollNumberReadResult } from '../scanning/roll-number';

export interface RosterEntry {
  /** As typed in the CSV, not normalized — this is what's shown back to the teacher (e.g. in a roster list or a future export), preserving whatever zero-padding/format they used. Matching uses `normalizeRollNumber`, never this raw form directly. */
  rollNumber: string;
  studentName: string;
}

export interface Roster {
  /** Stable identity for this class's roster envelope — minted once (`crypto.randomUUID()`) when the class is first created, then reused by every subsequent re-upload so `putEnvelope`'s upsert-by-`recordId` semantics replace it in place rather than creating a duplicate. */
  recordId: string;
  className: string;
  entries: RosterEntry[];
}

export interface RosterCsvRowError {
  /** 1-based, counting from the first data row (a detected header row is never counted). */
  row: number;
  reason: string;
}

export interface ParsedRosterCsv {
  entries: RosterEntry[];
  errors: RosterCsvRowError[];
  /** The raw header row, if one was detected and skipped — surfaced so the upload UI can show the teacher exactly what was skipped rather than silently guessing. `null` when every row was treated as data. */
  skippedHeaderRow: string[] | null;
}

const ROLL_NUMBER_PATTERN = /^\d+$/;

/**
 * `FR-ROSTER-01`: "CSV: roll number, student name" — a fixed column
 * order, an optional header row. A header is *detected*, never required:
 * `FR-DETECT-04` roll numbers are always "a grid of digits," so a real
 * data row's first cell is always all-digits — a first cell that isn't
 * (e.g. "Roll Number") is the signal. Every remaining row is validated
 * independently so one bad row (non-numeric roll number, missing name, a
 * duplicate) is reported and skipped rather than either silently
 * discarding the *entire* upload or silently keeping an entry that could
 * never match a scanned sheet anyway — the same "never silently drop
 * without teacher awareness" spirit CLAUDE.md states for scan results,
 * applied here at upload time instead.
 */
export function parseRosterCsv(text: string): ParsedRosterCsv {
  const rows = parseCsv(text);
  if (rows.length === 0) return { entries: [], errors: [], skippedHeaderRow: null };

  const firstCell = rows[0]![0]?.trim() ?? '';
  const hasHeader = !ROLL_NUMBER_PATTERN.test(firstCell);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const entries: RosterEntry[] = [];
  const errors: RosterCsvRowError[] = [];
  const seenRollNumbers = new Set<string>();

  dataRows.forEach((cells, i) => {
    const row = i + 1;
    const rollNumber = cells[0]?.trim() ?? '';
    const studentName = cells[1]?.trim() ?? '';

    if (rollNumber.length === 0 && studentName.length === 0) return; // a stray blank data row

    if (!ROLL_NUMBER_PATTERN.test(rollNumber)) {
      errors.push({ row, reason: `"${rollNumber}" isn't a valid roll number (digits only).` });
      return;
    }
    if (studentName.length === 0) {
      errors.push({ row, reason: `Roll number ${rollNumber} has no student name.` });
      return;
    }
    const normalized = normalizeRollNumber(rollNumber);
    if (seenRollNumbers.has(normalized)) {
      errors.push({ row, reason: `Roll number ${rollNumber} appears more than once.` });
      return;
    }
    seenRollNumbers.add(normalized);
    entries.push({ rollNumber, studentName });
  });

  return { entries, errors, skippedHeaderRow: hasHeader ? rows[0]! : null };
}

/**
 * Canonical comparison key for a roll number: strips leading zeros, so
 * "7", "07", and "007" are all the same identity. A scanned sheet's roll
 * number is a fixed-width, zero-padded digit grid whose width is a
 * property of the *template* (`geometry.rollNumberColumns.length`), not
 * of the roster — a teacher's freely-typed CSV cell has no reason to
 * agree on that width, and different exams for the same class could even
 * use different templates. Comparing by numeric identity rather than
 * exact string equality sidesteps that entirely.
 */
export function normalizeRollNumber(raw: string): string {
  return raw.trim().replace(/^0+(?=\d)/, '');
}

/** Normalized roll number -> student name, for O(1) matching against a scanned read. */
export function buildRosterLookup(roster: Roster): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const entry of roster.entries) {
    lookup.set(normalizeRollNumber(entry.rollNumber), entry.studentName);
  }
  return lookup;
}

export type RosterMatchOutcome =
  | { needsReview: false; studentName: string | null }
  | { needsReview: true; reason: 'unread' | 'unmatched' };

/**
 * The integration point `roll-number.ts`'s own doc comment anticipated
 * ("no roster/class-list data model is defined yet... this function only
 * ever needs membership") and `review-queue.ts`'s own doc comment flagged
 * as "a small, additive follow-up... not a redesign." `roster` being
 * `null` means exactly what "no roster" already meant before this task
 * existed: a successfully-read roll number is accepted as-is, with no
 * name attached — rostering is opt-in (`FR-ROSTER-01`'s "teacher uploads
 * a class list"), never a precondition for scanning at all. Reuses
 * `matchRollNumber` (the actual tested gate, not a second parallel
 * membership check) rather than re-implementing set membership here;
 * this function's only real job is the normalization `matchRollNumber`
 * itself deliberately knows nothing about.
 */
export function resolveRollNumberAgainstRoster(
  rollRead: RollNumberReadResult,
  roster: ReadonlyMap<string, string> | null,
): RosterMatchOutcome {
  if (roster === null) {
    return rollRead.status === 'read'
      ? { needsReview: false, studentName: null }
      : { needsReview: true, reason: 'unread' };
  }

  const normalizedRead: RollNumberReadResult =
    rollRead.status === 'read'
      ? { status: 'read', value: normalizeRollNumber(rollRead.value) }
      : rollRead;
  const match = matchRollNumber(normalizedRead, new Set(roster.keys()));

  if (match.status === 'matched') {
    return { needsReview: false, studentName: roster.get(match.rollNumber) ?? null };
  }
  if (match.status === 'unmatched') {
    return { needsReview: true, reason: 'unmatched' };
  }
  return { needsReview: true, reason: 'unread' };
}

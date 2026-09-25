/**
 * Roll-number grid reading (FR-DETECT-04) — framework-agnostic, per
 * ARCHITECTURE.md §3.
 *
 * A roll-number grid is a sequence of digit columns, each one a bubble
 * group of 10 options (0-9). That's structurally identical to what
 * `classifyQuestion` (bubble-fill.ts) already classifies — a "column"
 * IS a "question" with 10 options instead of, say, 4 — so this module
 * doesn't duplicate any sampling or classification logic. It only adds
 * what's genuinely new: combining one classification per column into a
 * roll-number string, and matching that string against a roster.
 *
 * Deliberately no code here samples pixels or knows where a roll-number
 * grid is positioned on a sheet — same scope boundary bubble-fill.ts
 * documents for itself: the real template reader that would map
 * `lib/templates/geometry.ts`'s `rollNumberColumns` (confirmed by
 * M2-001) to actual pixel regions is still a later milestone's job
 * (M2-004/M2-005's scan flow), and "same bubble-reading technique
 * applied to the roll-number block" (this task's own description in
 * TASKS.md) presupposes a caller that already has per-column
 * classifications, the same way bubble-fill.ts presupposes a caller
 * that already has bubble regions. See docs/reports/SHARLO-M1-009.md.
 */

import type { QuestionResult } from './bubble-fill';

export type RollNumberReadResult = { status: 'read'; value: string } | { status: 'unreadable' };

/**
 * Combines one classifyQuestion() result per digit column (in reading
 * order) into a roll-number string. Unlike an answer question, a roll
 * number has no legitimate "blank" digit — a real roll number has a
 * mark in every column — so `blank` is treated exactly like `flagged`
 * here: either one makes the *whole* roll number unreadable, never
 * partially filled in with a guess or a gap. This is the actual
 * enforcement point for FR-DETECT-04's "never silently discarded":
 * there's no code path that returns `status: 'read'` from anything
 * other than every single column being a confident, unambiguous digit.
 */
export function readRollNumber(columnResults: readonly QuestionResult[]): RollNumberReadResult {
  const digits: string[] = [];
  for (const column of columnResults) {
    if (column.outcome !== 'answered') {
      return { status: 'unreadable' };
    }
    digits.push(String(column.optionIndex));
  }
  return { status: 'read', value: digits.join('') };
}

export type RollNumberMatchResult =
  | { status: 'matched'; rollNumber: string }
  | { status: 'unread' }
  | { status: 'unmatched'; rollNumber: string };

/**
 * FR-DETECT-04: "If the read roll number doesn't match any roster
 * entry, the sheet is routed to the Review Queue... never silently
 * discarded." `roster` is deliberately just the set of valid roll-number
 * strings, not a full student-record schema — no roster/class-list data
 * model is defined yet (a later milestone's job), and this function only
 * ever needs membership, not the rest of a roster record. Every outcome
 * except `matched` is this function's way of saying "route to Review
 * Queue" — the caller doesn't need to separately remember to check for
 * a silent-discard case.
 */
export function matchRollNumber(
  read: RollNumberReadResult,
  roster: ReadonlySet<string>,
): RollNumberMatchResult {
  if (read.status === 'unreadable') return { status: 'unread' };
  if (!roster.has(read.value)) return { status: 'unmatched', rollNumber: read.value };
  return { status: 'matched', rollNumber: read.value };
}

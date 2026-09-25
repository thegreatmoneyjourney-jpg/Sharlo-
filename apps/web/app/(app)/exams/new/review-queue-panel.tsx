'use client';

import { useState } from 'react';
import type { QuestionResolution } from '@/lib/scanning/score-answers';

export type ReviewQueueItem =
  | {
      id: string;
      studentId: number;
      /** `Date.now()` when this item entered the queue — deliberately wall-clock/epoch time, not the frame's own `capturedAt` (a `performance.now()`-relative RAF timestamp, incompatible with `Date.now()` arithmetic). Used only to drive the M2-007 retention purge below. */
      addedAt: number;
      /** Null once purged past the retention window (M2-007, FR-REVIEW-03) — the item itself and its resolve controls stay fully functional; only the visual aid is gone. */
      cropDataUrl: string | null;
      kind: 'question';
      questionNumber: number;
      optionCount: number;
    }
  | {
      id: string;
      studentId: number;
      addedAt: number;
      cropDataUrl: string | null;
      kind: 'roll-number';
    };

const CHOICE_BUTTON_CLASSES =
  'rounded border border-zinc-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700';
const ACTION_BUTTON_CLASSES =
  'rounded border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700';

/**
 * M2-007 (FR-REVIEW-03, NFR-SEC-05): returns a new array with every item
 * whose crop has sat past `retentionMs` since `addedAt` purged
 * (`cropDataUrl` set to `null`) — the item itself is never removed, only
 * its image; see `exam-scan-flow.tsx`'s purge-interval doc comment for
 * why dropping the item would break this feature's own trust guarantee.
 * Deliberately pure (no timers, no `Date.now()` call of its own) so it's
 * directly unit-testable without fighting fake timers against
 * `@testing-library`'s own async polling — `exam-scan-flow.tsx` is the
 * only caller, on its own `setInterval`, passing in the current time.
 * Returns the exact same array reference when nothing changed, so a
 * caller can skip a state update rather than triggering a needless
 * re-render every tick.
 */
export function purgeExpiredCrops(
  items: readonly ReviewQueueItem[],
  now: number,
  retentionMs: number,
): ReviewQueueItem[] {
  const cutoff = now - retentionMs;
  let changed = false;
  const purged = items.map((item) => {
    if (item.cropDataUrl !== null && item.addedAt <= cutoff) {
      changed = true;
      return { ...item, cropDataUrl: null };
    }
    return item;
  });
  return changed ? purged : (items as ReviewQueueItem[]);
}

function QuestionResolveRow({
  item,
  onResolve,
}: {
  item: Extract<ReviewQueueItem, { kind: 'question' }>;
  onResolve: (resolution: QuestionResolution) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {Array.from({ length: item.optionCount }, (_, optionIndex) => (
        <button
          key={optionIndex}
          type="button"
          onClick={() => onResolve({ action: 'pick', optionIndex })}
          className={CHOICE_BUTTON_CLASSES}
        >
          {String.fromCharCode(65 + optionIndex)}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onResolve({ action: 'mark-blank' })}
        className={ACTION_BUTTON_CLASSES}
      >
        Left blank
      </button>
      <button
        type="button"
        onClick={() => onResolve({ action: 'exclude' })}
        className={ACTION_BUTTON_CLASSES}
      >
        Exclude
      </button>
    </div>
  );
}

function RollNumberResolveRow({ onResolve }: { onResolve: (rollNumber: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="review-roll-number-input">
        Correct roll number
      </label>
      <input
        id="review-roll-number-input"
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Roll number"
        className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-sm text-white"
      />
      <button
        type="button"
        disabled={value.trim().length === 0}
        onClick={() => onResolve(value.trim())}
        className={`${CHOICE_BUTTON_CLASSES} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        Save
      </button>
    </div>
  );
}

/**
 * FR-REVIEW-01/02 + FR-DETECT-04's Review Queue — a non-blocking overlay
 * (not a separate route/step) so resolving items never interrupts the
 * M2-005-proven continuous scan loop; the teacher opens it between
 * captures, resolves what they can, and closes it to keep scanning.
 * Roll-number items resolve by typing the correct number rather than
 * picking from a roster — there's no class-list/rostering data model in
 * this codebase yet (a later milestone's job), so this is the only
 * resolution FR-DETECT-04's "route to Review Queue" wording actually
 * supports today; see docs/reports/SHARLO-M2-006.md's Flags. `cropDataUrl`
 * can be null (M2-007, FR-REVIEW-03) — `exam-scan-flow.tsx` purges it on a
 * retention timer, but never drops the item itself, since a flagged
 * question with no resolution is exactly the "silently dropped" failure
 * this whole feature exists to prevent.
 */
export function ReviewQueuePanel({
  items,
  onResolveQuestion,
  onResolveRollNumber,
  onClose,
}: {
  items: ReviewQueueItem[];
  onResolveQuestion: (
    item: Extract<ReviewQueueItem, { kind: 'question' }>,
    resolution: QuestionResolution,
  ) => void;
  onResolveRollNumber: (
    item: Extract<ReviewQueueItem, { kind: 'roll-number' }>,
    rollNumber: string,
  ) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto bg-black/95 p-4 text-white">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Review Needed ({items.length})</h2>
        <button type="button" onClick={onClose} className={ACTION_BUTTON_CLASSES}>
          Close
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-300" role="status">
          Fully graded — every scanned sheet is resolved.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id} className="rounded bg-zinc-900 p-3">
              <p className="mb-2 text-xs font-medium text-zinc-400">
                {item.kind === 'question' ? `Question ${item.questionNumber}` : 'Roll number'}
              </p>
              {item.cropDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a locally-generated data: URL crop, not a remote image Next's <Image> optimizer has anything to do with
                <img
                  src={item.cropDataUrl}
                  alt={
                    item.kind === 'question'
                      ? `Cropped image of question ${item.questionNumber}`
                      : 'Cropped image of the roll-number grid'
                  }
                  className="mb-2 max-w-full rounded border border-zinc-700"
                />
              ) : (
                <p className="mb-2 rounded border border-zinc-700 bg-zinc-800 px-3 py-4 text-center text-xs text-zinc-400">
                  Image no longer available — it was purged after sitting unresolved for a while.
                  You can still resolve this from memory or the roll number below.
                </p>
              )}
              {item.kind === 'question' ? (
                <QuestionResolveRow
                  item={item}
                  onResolve={(resolution) => onResolveQuestion(item, resolution)}
                />
              ) : (
                <RollNumberResolveRow
                  onResolve={(rollNumber) => onResolveRollNumber(item, rollNumber)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

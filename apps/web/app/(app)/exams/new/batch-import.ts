import { loadPdfDocument } from '@/lib/scanning/load-pdf-file';
import type { LoadedPdfDocument } from '@/lib/scanning/load-pdf-file';
import type { Mode } from './exam-scan-mode';

/**
 * M2-009 (FR-EXAM-04): one flat, page-level work queue for a batch import
 * — a multi-page PDF contributes one item per page, expanded up front by
 * `buildBatchQueue` so "processing sheet N of M" in the UI covers every
 * page of every file, not just file count, and is known before
 * processing starts rather than discovered mid-run.
 */
export type BatchQueueItem =
  | { kind: 'image'; label: string; file: File }
  | { kind: 'pdf-page'; label: string; doc: LoadedPdfDocument; pageNumber: number };

/** One item that didn't make it into `students`/`reviewQueue` — surfaced to the teacher, never silently dropped (see CLAUDE.md's never-guess/never-drop trust guarantee, which this extends from single flagged *questions* to whole unreadable *sheets*). */
export interface BatchFailure {
  label: string;
  reason: string;
}

/**
 * `succeeded` is tracked directly rather than derived as
 * `items.length - failures.length` — `failures` also carries files
 * rejected before ever becoming an item (unsupported type, a PDF that
 * failed to parse; see `buildBatchQueue`), so that subtraction would
 * double-count them: `items.length` already excludes them, so
 * subtracting them again undercounts real successes.
 */
export type BatchImportState =
  | { phase: 'preparing' }
  | {
      phase: 'processing';
      items: BatchQueueItem[];
      index: number;
      succeeded: number;
      failures: BatchFailure[];
    }
  | { phase: 'done'; items: BatchQueueItem[]; succeeded: number; failures: BatchFailure[] };

export const NO_SHEET_DETECTED_REASON =
  "Couldn't find the sheet's corner markers — try a clearer, well-lit, uncropped scan.";

/** The file picker's own `accept` narrows this in the common case, but a picker's `accept` is only ever a hint the OS/browser may not enforce — this is the real gate. */
export function classifyFile(file: File): 'image' | 'pdf' | 'unsupported' {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type.startsWith('image/')) return 'image';
  return 'unsupported';
}

export function startBatch(
  items: BatchQueueItem[],
  initialFailures: BatchFailure[] = [],
): BatchImportState {
  return items.length === 0
    ? { phase: 'done', items, succeeded: 0, failures: initialFailures }
    : { phase: 'processing', items, index: 0, succeeded: 0, failures: initialFailures };
}

export function advanceBatch(batch: BatchImportState, failure?: BatchFailure): BatchImportState {
  if (batch.phase !== 'processing') return batch;
  const succeeded = failure ? batch.succeeded : batch.succeeded + 1;
  const failures = failure ? [...batch.failures, failure] : batch.failures;
  const index = batch.index + 1;
  return index >= batch.items.length
    ? { phase: 'done', items: batch.items, succeeded, failures }
    : { ...batch, index, succeeded, failures };
}

/**
 * `applyReadResult`'s capture-key branch never throws or drops a bad key
 * attempt — it just re-returns `{ phase: 'capture-key', error }` and
 * waits for another try. That's fine for live capture (the teacher sees
 * the error overlay and rescans the same sheet), but in a batch that
 * "another try" is a *different file* advancing past it — without this
 * check, a rejected key attempt would silently vanish from the batch's
 * results instead of being reported like any other failed item. Detects
 * that case from before/after `Mode` alone, no extra plumbing needed.
 */
export function keyAttemptRejection(prev: Mode, next: Mode): string | null {
  if (prev.phase !== 'capture-key' || next.phase !== 'capture-key') return null;
  return next.error ?? null;
}

/**
 * A file this can't even open (unsupported type, a PDF that fails to
 * parse) becomes an immediate failure rather than aborting the whole
 * batch — one bad file in a stack of 30 shouldn't cost the other 29.
 * Only opens each PDF's structure to read its page count; the actual
 * per-page rendering happens later, one page at a time, as the returned
 * queue is processed (see `exam-scan-flow.tsx`) — never all up front,
 * which would hold every page's full-resolution `ImageData` in memory
 * at once for a large PDF.
 */
export async function buildBatchQueue(
  files: File[],
): Promise<{ items: BatchQueueItem[]; failures: BatchFailure[] }> {
  const items: BatchQueueItem[] = [];
  const failures: BatchFailure[] = [];

  for (const file of files) {
    const kind = classifyFile(file);
    if (kind === 'unsupported') {
      failures.push({ label: file.name, reason: 'Not a supported image or PDF file.' });
      continue;
    }
    if (kind === 'image') {
      items.push({ kind: 'image', label: file.name, file });
      continue;
    }
    try {
      const doc = await loadPdfDocument(file);
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        items.push({
          kind: 'pdf-page',
          label:
            doc.numPages > 1 ? `${file.name} (page ${pageNumber} of ${doc.numPages})` : file.name,
          doc,
          pageNumber,
        });
      }
    } catch (err) {
      failures.push({
        label: file.name,
        reason: err instanceof Error ? err.message : "Couldn't open this PDF file.",
      });
    }
  }

  return { items, failures };
}

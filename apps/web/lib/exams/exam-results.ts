import type { QuestionResult } from '../scanning/bubble-fill';
import type { ScoredSheet } from '../scanning/score-answers';
import { decryptEnvelope, encryptEnvelope } from '../storage/envelope-crypto';
import type { Bytes } from '../crypto/encoding';
import type { EnvelopeStore } from '../storage/envelope-store';

/**
 * `M3-008` (`FR-EXAM-01`/`03`, `FR-RESULTS-01`/`02`) — the first task to
 * actually write a real `examResults` envelope, so this is also where
 * `ARCHITECTURE.md` §7's illustrative `"examKey"` type (listed alongside
 * `"examResults"` as if the two might be separate envelopes) gets
 * resolved: there is only ever **one** envelope per exam, type
 * `examResults`, holding the captured key *and* every student's scored
 * sheet together. A separate `examKey` envelope would need its own
 * linkage back to the results it scores, for no real benefit — this
 * product always captures a key immediately before scanning students
 * for it, and every subsequent write already re-saves the whole exam
 * record (`§7`'s own "one `examResults` file = one exam" granularity
 * note already rules out splitting by student; this resolves the
 * narrower key-vs-results question the same way, for the same reason).
 * `ARCHITECTURE.md` §7 is updated to drop the stray `"examKey"` mention.
 */

/** One scanned student sheet, accumulated across a scan-students session (`M2-006`) and persisted as-is (`M3-008`) — `scored` is re-derived via `rescoreSheet`/`applyReviewResolution`, never hand-edited in place. Lives here (not in `app/(app)/exams/new/exam-scan-mode.ts`, which only re-exports it) because both the live scan flow and the persistence layer need the identical shape, and `lib/` must not depend on `app/`. */
export interface StudentResult {
  id: number;
  rollNumber: string | null;
  /** `M3-007` (`FR-ROSTER-02`) — the matched roster entry's name, or `null` when no roster was selected for this exam, the roll number didn't match one, or it couldn't be read at all. */
  name: string | null;
  scored: ScoredSheet;
}

export interface ExamResults {
  /** Stable identity for this exam's envelope — minted once (`crypto.randomUUID()`) when the exam is first saved. */
  recordId: string;
  title: string;
  /** Sufficient to regenerate the stock template's geometry if ever needed (`computeStockTemplateGeometry`) — scoring/display here only ever needs `key`/`students`, never the full geometry. */
  questionCount: number;
  /** The captured answer key, same `QuestionResult[]` shape `scoreSheet` already operates on. */
  key: QuestionResult[];
  /** Which class's roster (if any) this exam was scanned against — `null` when rostering was skipped, matching `M3-007`'s opt-in design. */
  rosterId: string | null;
  students: StudentResult[];
  /** ISO 8601 — set once, at first save, never updated on a later edit; the exams-list page's own sort/display key. */
  createdAt: string;
}

const EXAM_RESULTS_ENVELOPE_TYPE = 'examResults';

interface ExamResultsContent {
  title: string;
  questionCount: number;
  key: QuestionResult[];
  rosterId: string | null;
  students: StudentResult[];
  createdAt: string;
}

function toExamResults(recordId: string, content: ExamResultsContent): ExamResults {
  return { recordId, ...content };
}

/** Creates a new exam, or overwrites an existing one in place (every edit re-saves the whole record) — the same upsert-by-`recordId` semantic every other envelope type already has. */
export async function saveExamResults(
  store: EnvelopeStore,
  masterKey: Bytes,
  exam: ExamResults,
): Promise<void> {
  const { recordId, ...content } = exam;
  const envelope = await encryptEnvelope(
    masterKey,
    EXAM_RESULTS_ENVELOPE_TYPE,
    recordId,
    content satisfies ExamResultsContent,
  );
  await store.putEnvelope(envelope);
}

/** Every saved exam on this account — for the `/exams` list page. */
export async function listExamResults(
  store: EnvelopeStore,
  masterKey: Bytes,
): Promise<ExamResults[]> {
  const envelopes = await store.listEnvelopesByType(EXAM_RESULTS_ENVELOPE_TYPE);
  return Promise.all(
    envelopes.map(async (envelope) => {
      const content = await decryptEnvelope<ExamResultsContent>(masterKey, envelope);
      return toExamResults(envelope.recordId, content);
    }),
  );
}

export async function loadExamResults(
  store: EnvelopeStore,
  masterKey: Bytes,
  recordId: string,
): Promise<ExamResults | undefined> {
  const envelope = await store.getEnvelope(recordId);
  if (!envelope) return undefined;
  const content = await decryptEnvelope<ExamResultsContent>(masterKey, envelope);
  return toExamResults(recordId, content);
}

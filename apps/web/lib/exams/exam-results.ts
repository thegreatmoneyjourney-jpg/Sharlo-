import type { QuestionResult } from '../scanning/bubble-fill';
import type { ScoredSheet } from '../scanning/score-answers';
import { decryptEnvelope, encryptEnvelope } from '../storage/envelope-crypto';
import { migrateEnvelopeContent } from '../storage/envelope-migration';
import { hexToBytes, type Bytes } from '../crypto/encoding';
import { openSealedBox, sealToPublicKey, type X25519KeyPair } from '../crypto/x25519';
import type { EnvelopeStore } from '../storage/envelope-store';
import type { StoredEnvelope } from '../storage/local-envelope-store';
import type { SealedRecord } from '../storage/school-container-store';

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

/** `M3-013`: this type's own content-shape version — bump this and add a `EXAM_RESULTS_MIGRATIONS[N]` entry when `ExamResultsContent`'s shape ever changes; never touch `envelope-crypto.ts`'s generic encryption to do it. */
const CURRENT_EXAM_RESULTS_SCHEMA_VERSION = 1;

/** No migrations registered yet — nothing has ever needed one. Kept here, not inlined at the call site, so the next real migration's `[N]: fn` entry is the only addition a future change needs to make. */
const EXAM_RESULTS_MIGRATIONS: Record<number, (content: unknown) => unknown> = {};

/** Exported so `sealExamResultsForSchool`/`unsealExamResultsForSchool` (`M3-016`) can share this exact shape — the school-sealed copy and the individual AES-GCM envelope hold identical content, just under two different crypto wrappers. */
export interface ExamResultsContent {
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
    CURRENT_EXAM_RESULTS_SCHEMA_VERSION,
  );
  await store.putEnvelope(envelope);
}

async function decryptAndMigrateExamResults(
  masterKey: Bytes,
  envelope: StoredEnvelope,
): Promise<ExamResults> {
  const raw = await decryptEnvelope<unknown>(masterKey, envelope);
  const content = migrateEnvelopeContent<ExamResultsContent>(
    envelope.schemaVersion,
    CURRENT_EXAM_RESULTS_SCHEMA_VERSION,
    raw,
    EXAM_RESULTS_MIGRATIONS,
  );
  return toExamResults(envelope.recordId, content);
}

/** Every saved exam on this account — for the `/exams` list page. */
export async function listExamResults(
  store: EnvelopeStore,
  masterKey: Bytes,
): Promise<ExamResults[]> {
  const envelopes = await store.listEnvelopesByType(EXAM_RESULTS_ENVELOPE_TYPE);
  return Promise.all(
    envelopes.map((envelope) => decryptAndMigrateExamResults(masterKey, envelope)),
  );
}

export async function loadExamResults(
  store: EnvelopeStore,
  masterKey: Bytes,
  recordId: string,
): Promise<ExamResults | undefined> {
  const envelope = await store.getEnvelope(recordId);
  if (!envelope) return undefined;
  return decryptAndMigrateExamResults(masterKey, envelope);
}

/** `M3-016`/`ADR-0010` — the Drive `appProperties`/`SealedRecord.type` tag for a school-key copy, deliberately distinct from `EXAM_RESULTS_ENVELOPE_TYPE` so a Drive query (or a future admin-dashboard listing, `M3-017`) can never confuse a teacher's own individual envelope with a sealed school copy, even though both ever hold byte-identical `ExamResultsContent`. */
export const SCHOOL_EXAM_RESULTS_SEALED_TYPE = 'schoolExamResults';

/**
 * Seals this exam's content (same `ExamResultsContent` shape the
 * individual AES-GCM envelope holds — `recordId` stays out of the sealed
 * payload itself, same as the individual path, and travels only as
 * `SealedRecord.recordId`) to the school admin's X25519 public key
 * (`school_members.adminX25519PublicKey`, denormalized at join time).
 * `sealToPublicKey` needs no keypair of the *teacher's* own — see
 * `x25519.ts`'s own doc comment on why sealing can only ever flow
 * teacher→admin, never the reverse, with this codebase's current
 * primitives (only the admin has a keypair at all).
 */
export async function sealExamResultsForSchool(
  adminX25519PublicKeyHex: string,
  exam: ExamResults,
): Promise<SealedRecord> {
  const { recordId, ...content } = exam;
  const json = JSON.stringify(content satisfies ExamResultsContent);
  const message: Bytes = new Uint8Array(new TextEncoder().encode(json));
  const sealedCiphertext = await sealToPublicKey(hexToBytes(adminX25519PublicKeyHex), message);
  return {
    schemaVersion: CURRENT_EXAM_RESULTS_SCHEMA_VERSION,
    type: SCHOOL_EXAM_RESULTS_SEALED_TYPE,
    recordId,
    sealedCiphertext,
  };
}

/**
 * Opens a school-sealed record back into `ExamResults` — the admin-side
 * counterpart to `sealExamResultsForSchool`, needing the admin's full
 * X25519 keypair (`unwrapAdminX25519PrivateKey`, `school-key.ts`). Not
 * called anywhere in product code yet (`M3-017`'s principal dashboard is
 * the real future caller) — built and tested now alongside the seal side
 * of the same primitive, the same "build the complete, tested pair now"
 * precedent `master-key.ts`'s `rewrapMasterKeyByNewRecoveryKey` already
 * set for `M3-004`. Reuses `EXAM_RESULTS_MIGRATIONS` — the sealed and
 * individually-encrypted copies hold the exact same content shape, so a
 * future schema change migrates both identically.
 */
export async function unsealExamResultsForSchool(
  adminKeyPair: X25519KeyPair,
  sealed: SealedRecord,
): Promise<ExamResults> {
  const plaintext = await openSealedBox(adminKeyPair, sealed.sealedCiphertext);
  const raw = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  const content = migrateEnvelopeContent<ExamResultsContent>(
    sealed.schemaVersion,
    CURRENT_EXAM_RESULTS_SCHEMA_VERSION,
    raw,
    EXAM_RESULTS_MIGRATIONS,
  );
  return toExamResults(sealed.recordId, content);
}

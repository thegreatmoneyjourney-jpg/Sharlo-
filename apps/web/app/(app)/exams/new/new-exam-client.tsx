'use client';

import { useMemo, useState } from 'react';
import {
  STOCK_TEMPLATE_QUESTION_COUNTS,
  computeStockTemplateGeometry,
} from '@/lib/templates/geometry';
import type { StockTemplateQuestionCount, TemplateGeometry } from '@/lib/templates/geometry';
import { buildRosterLookup } from '@/lib/roster/roster';
import type { Roster } from '@/lib/roster/roster';
import { getEnvelopeStore } from '@/lib/storage/envelope-store';
import { saveExamResults } from '@/lib/exams/exam-results';
import type { ExamResults } from '@/lib/exams/exam-results';
import { syncExamResultsToSchool } from '@/lib/exams/school-result-sync';
import type { Bytes } from '@/lib/crypto/encoding';
import { ExamScanFlow } from './exam-scan-flow';
import type { Mode } from './exam-scan-mode';
import { RosterPicker } from './roster-picker';
import { RequireMasterKey } from '../../require-master-key';

interface ExamSetup {
  title: string;
  questionCount: number;
  geometry: TemplateGeometry;
  roster: ReadonlyMap<string, string> | null;
  rosterId: string | null;
}

/**
 * `M3-008` — the step between "End exam" and landing on the saved
 * exam's Results Table. Gated behind `RequireMasterKey` (saving is
 * never optional, unlike the roster step above) and an explicit "Save
 * and view results" click rather than auto-saving the instant the
 * passphrase is entered — consistent with every other state-changing
 * action in this app requiring a deliberate button press.
 */
function SaveExamStep({
  masterKey,
  setup,
  mode,
  onSaved,
  onCancel,
}: {
  masterKey: Bytes;
  setup: ExamSetup;
  mode: Extract<Mode, { phase: 'scan-students' }>;
  onSaved: (recordId: string) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setBusy(true);
    try {
      const store = await getEnvelopeStore();
      const exam: ExamResults = {
        recordId: crypto.randomUUID(),
        title: setup.title,
        questionCount: setup.questionCount,
        key: mode.key,
        rosterId: setup.rosterId,
        students: mode.students,
        createdAt: new Date().toISOString(),
      };
      await saveExamResults(store, masterKey, exam);
      // `M3-016` — a best-effort, non-blocking school-copy write: the
      // teacher's own save above has already durably succeeded by this
      // point, so a school-copy problem (not a member yet, Picker step
      // not done, a transient Drive error) must never hold up or fail
      // *this* save — `syncExamResultsToSchool` never throws, and the
      // "not eligible yet" cases are already surfaced by the standing
      // `SchoolDriveAccessBanner` on every page, including wherever this
      // redirects to next. A genuine write failure is logged for
      // visibility, not surfaced inline — see docs/reports/SHARLO-M3-016.md
      // for why building retry UX for this edge case is deferred.
      const schoolSync = await syncExamResultsToSchool(exam);
      if (schoolSync.attempted && !schoolSync.ok) {
        console.error('Failed to write school-key copy of exam results:', schoolSync.error);
      }
      onSaved(exam.recordId);
    } catch {
      setError("Couldn't save this exam. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {mode.students.length} student{mode.students.length === 1 ? '' : 's'} scanned for{' '}
        <strong>{setup.title}</strong>.
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={SECONDARY_BUTTON_CLASSES}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleSave}
          className={PRIMARY_BUTTON_CLASSES}
        >
          {busy ? 'Saving…' : 'Save and view results'}
        </button>
      </div>
    </div>
  );
}

const PRIMARY_BUTTON_CLASSES =
  'rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40';
const SECONDARY_BUTTON_CLASSES =
  'rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900';

/**
 * M2-004 (FR-EXAM-03) — exam creation + the answer-key scan flow.
 * "Custom templates" isn't offered here yet: M2-003's custom-template
 * flow doesn't persist a template beyond its own page (no auth/owner_id
 * to save against — see `docs/reports/SHARLO-M2-003.md`), so there's
 * nothing durable to list in a picker here. Stock templates are fully
 * usable end to end today; wiring a session-held custom template into
 * this picker is a reasonable, low-risk follow-up once persistence
 * exists, not a silent gap — flagged in `docs/reports/SHARLO-M2-004.md`.
 *
 * `M3-007` (`FR-ROSTER-01`) added an optional "Add a class list" step,
 * collapsed behind a toggle so a teacher who doesn't use rostering sees
 * zero change from before — no passphrase prompt, no extra click. Only
 * once opted in does `RequireMasterKey` ask for the passphrase (a roster
 * is real encrypted data), and only then does `RosterPicker` fetch this
 * account's saved classes.
 *
 * `M3-008` closes the "save this exam" gap M2-004 through M3-007 all
 * deferred: ending a scan-students session (`handleEndExam`) now shows
 * `SaveExamStep` instead of silently discarding everything, which
 * saves the exam as a real encrypted envelope and lands on its Results
 * Table (`/exams/[id]`). Ending during `capture-key` phase (nothing
 * captured yet) stays a plain discard, unchanged.
 */
export default function NewExamClient() {
  const [setup, setSetup] = useState<ExamSetup | null>(null);
  const [endedMode, setEndedMode] = useState<Extract<Mode, { phase: 'scan-students' }> | null>(
    null,
  );
  const [titleInput, setTitleInput] = useState('');
  const [questionCount, setQuestionCount] = useState<StockTemplateQuestionCount>(
    STOCK_TEMPLATE_QUESTION_COUNTS[0],
  );
  const [wantsRoster, setWantsRoster] = useState(false);
  const [selectedRoster, setSelectedRoster] = useState<Roster | null>(null);
  const rosterLookup = useMemo(
    () => (selectedRoster ? buildRosterLookup(selectedRoster) : null),
    [selectedRoster],
  );

  function handleEndExam(mode: Mode) {
    if (mode.phase === 'capture-key') {
      setSetup(null); // nothing captured yet -- plain discard, same as always
      return;
    }
    setEndedMode(mode);
  }

  if (setup && endedMode) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Save exam</h1>
        <RequireMasterKey unlockDescription="Enter your Encryption Passphrase to save this exam.">
          {(masterKey) => (
            <SaveExamStep
              masterKey={masterKey}
              setup={setup}
              mode={endedMode}
              onSaved={(recordId) => {
                window.location.href = `/exams/${recordId}`;
              }}
              onCancel={() => {
                setEndedMode(null);
                setSetup(null);
              }}
            />
          )}
        </RequireMasterKey>
      </div>
    );
  }

  if (setup) {
    return (
      <ExamScanFlow
        examTitle={setup.title}
        geometry={setup.geometry}
        roster={setup.roster}
        onEndExam={handleEndExam}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Create an exam</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Choose a Sharlo template and scan the answer key first — every sheet you scan after that
          is scored against it immediately.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Exam title
        <input
          type="text"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          placeholder="e.g. Grade 8 — Chapter 4 quiz"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Template</legend>
        {STOCK_TEMPLATE_QUESTION_COUNTS.map((count) => (
          <label
            key={count}
            className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
          >
            <input
              type="radio"
              name="template"
              checked={questionCount === count}
              onChange={() => setQuestionCount(count)}
            />
            Sharlo {count}-question sheet
          </label>
        ))}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Custom templates aren&rsquo;t available here yet — coming soon.
        </p>
      </fieldset>

      <div className="flex flex-col gap-2">
        {!wantsRoster ? (
          <button
            type="button"
            onClick={() => setWantsRoster(true)}
            className={SECONDARY_BUTTON_CLASSES}
          >
            Add a class list (optional)
          </button>
        ) : (
          <>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Class list (optional)
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Scanned roll numbers will be matched against this class and the student&rsquo;s name
              filled in automatically. Skip this if you&rsquo;d rather scan without one.
            </p>
            <RequireMasterKey unlockDescription="Enter your Encryption Passphrase to use a class list for this exam.">
              {(masterKey) => <RosterPicker masterKey={masterKey} onSelect={setSelectedRoster} />}
            </RequireMasterKey>
          </>
        )}
      </div>

      <button
        type="button"
        disabled={titleInput.trim().length === 0}
        onClick={() =>
          setSetup({
            title: titleInput.trim(),
            questionCount,
            geometry: computeStockTemplateGeometry(questionCount),
            roster: rosterLookup,
            rosterId: selectedRoster?.recordId ?? null,
          })
        }
        className={PRIMARY_BUTTON_CLASSES}
      >
        Start scanning the answer key
      </button>
    </div>
  );
}

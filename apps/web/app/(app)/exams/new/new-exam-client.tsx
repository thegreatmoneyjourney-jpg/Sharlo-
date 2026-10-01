'use client';

import { useMemo, useState } from 'react';
import {
  STOCK_TEMPLATE_QUESTION_COUNTS,
  computeStockTemplateGeometry,
} from '@/lib/templates/geometry';
import type { StockTemplateQuestionCount, TemplateGeometry } from '@/lib/templates/geometry';
import { buildRosterLookup } from '@/lib/roster/roster';
import type { Roster } from '@/lib/roster/roster';
import { ExamScanFlow } from './exam-scan-flow';
import { RosterPicker } from './roster-picker';
import { RequireMasterKey } from '../../require-master-key';

interface ExamSetup {
  title: string;
  geometry: TemplateGeometry;
  roster: ReadonlyMap<string, string> | null;
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
 * Like M2-003, this stops short of persisting the exam/results
 * themselves (no encrypted-envelope storage exists yet — M3). The setup
 * step and the full scan-key/score-students flow are real and fully
 * functional in memory for the current session; only the final "save
 * this exam" step is out of reach until a later M3 task.
 *
 * `M3-007` (`FR-ROSTER-01`) adds an optional "Add a class list" step,
 * collapsed behind a toggle so a teacher who doesn't use rostering sees
 * zero change from before — no passphrase prompt, no extra click. Only
 * once opted in does `RequireMasterKey` ask for the passphrase (a roster
 * is real encrypted data), and only then does `RosterPicker` fetch this
 * account's saved classes.
 */
export default function NewExamClient() {
  const [setup, setSetup] = useState<ExamSetup | null>(null);
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

  if (setup) {
    return (
      <ExamScanFlow
        examTitle={setup.title}
        geometry={setup.geometry}
        roster={setup.roster}
        onRestart={() => setSetup(null)}
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
            geometry: computeStockTemplateGeometry(questionCount),
            roster: rosterLookup,
          })
        }
        className={PRIMARY_BUTTON_CLASSES}
      >
        Start scanning the answer key
      </button>
    </div>
  );
}

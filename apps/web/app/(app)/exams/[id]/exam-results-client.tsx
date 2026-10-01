'use client';

import { useEffect, useState } from 'react';
import { getEnvelopeStore } from '@/lib/storage/envelope-store';
import type { EnvelopeStore } from '@/lib/storage/envelope-store';
import { loadExamResults, saveExamResults } from '@/lib/exams/exam-results';
import type { ExamResults, StudentResult } from '@/lib/exams/exam-results';
import { computeQuestionBreakdown } from '@/lib/exams/question-breakdown';
import type { QuestionBreakdown } from '@/lib/exams/question-breakdown';
import { computeClassAnalytics } from '@/lib/exams/class-analytics';
import type { ClassAnalytics } from '@/lib/exams/class-analytics';
import type { Bytes } from '@/lib/crypto/encoding';
import { RequireMasterKey } from '../../require-master-key';
import { ResultsGrid } from '../../results-grid';

type ViewState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; exam: ExamResults; store: EnvelopeStore };

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function SaveStatusIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === 'idle') return null;
  if (status === 'saving') {
    return (
      <span className="text-xs text-zinc-500 dark:text-zinc-400" role="status">
        Saving…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="text-xs text-emerald-600 dark:text-emerald-400" role="status">
        Saved
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400" role="alert">
      Couldn&rsquo;t save
      <button type="button" onClick={onRetry} className="underline">
        Retry
      </button>
    </span>
  );
}

function QuestionBreakdownView({ breakdown }: { breakdown: QuestionBreakdown[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Per-question breakdown
      </h2>
      <ul className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {breakdown.map((q) => (
          <li
            key={q.questionNumber}
            className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
          >
            Q{q.questionNumber}:{' '}
            {q.correctPercent === null ? '—' : `${Math.round(q.correctPercent)}%`} correct
          </li>
        ))}
      </ul>
    </div>
  );
}

const TOP_N = 5;

/**
 * `M3-009` (`FR-RESULTS-03`) — hardest questions / weakest students /
 * score distribution, reusing `computeClassAnalytics`'s own ranking
 * rather than re-sorting here. Shows only the top `TOP_N` of each ranked
 * list (the full lists exist for a future "see all" affordance, not
 * needed yet) and only the score-distribution buckets that actually have
 * a student in them, so an empty exam doesn't render ten zero rows.
 *
 * Per `docs/SRS.md` §5.9a this FR is Pro/School-only — same as
 * `FR-TPL-02` (custom templates, already shipped ungated in `M2-003`).
 * No entitlement-check layer exists yet (`M4-005`), so this view (like
 * that one) is deliberately left reachable by every account for now;
 * `M4-005`/`M8`–`M11`'s gating retrofit is expected to cover this call
 * site too, not just the ones it names explicitly.
 */
function ClassAnalyticsView({ analytics }: { analytics: ClassAnalytics }) {
  const nonEmptyBuckets = analytics.scoreDistribution.filter((b) => b.studentCount > 0);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Class analytics</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Hardest questions
          </h3>
          <ul className="flex flex-col gap-1 text-xs text-zinc-700 dark:text-zinc-300">
            {analytics.hardestQuestions.slice(0, TOP_N).map((q) => (
              <li key={q.questionNumber}>
                Q{q.questionNumber} —{' '}
                {q.correctPercent === null
                  ? 'no data'
                  : `${Math.round(q.correctPercent)}% got it right`}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Weakest students</h3>
          <ul className="flex flex-col gap-1 text-xs text-zinc-700 dark:text-zinc-300">
            {analytics.weakestStudents.slice(0, TOP_N).map((s) => (
              <li key={s.id}>
                {s.name ?? s.rollNumber ?? `Student ${s.id}`}:{' '}
                {s.correctPercent === null ? '—' : `${Math.round(s.correctPercent)}%`}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Score distribution
          </h3>
          <ul className="flex flex-col gap-1 text-xs text-zinc-700 dark:text-zinc-300">
            {nonEmptyBuckets.length === 0 && <li>No scored students yet.</li>}
            {nonEmptyBuckets.map((b) => (
              <li key={b.rangeStart}>
                {b.rangeStart}–{b.rangeEnd}%: {b.studentCount} student
                {b.studentCount === 1 ? '' : 's'}
              </li>
            ))}
            {analytics.unscoredStudentCount > 0 && (
              <li>
                {analytics.unscoredStudentCount} student
                {analytics.unscoredStudentCount === 1 ? '' : 's'} not yet scored
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * `M3-008` (`FR-RESULTS-01`/`02`) — the Results Table page. Loads the
 * saved exam once the master key is available (`RequireMasterKey`),
 * then renders the shared `ResultsGrid` (`FR-IMPORT-06`) plus a
 * per-question breakdown computed from the current (possibly-edited)
 * students array. Every grid edit re-encrypts and re-saves the whole
 * exam envelope immediately — no debounce — since WebCrypto AES-GCM on
 * a class-sized record is fast enough that batching would only add
 * complexity (a timing/flush-on-navigate edge case) for no real
 * performance win; revisit only if a real class size ever shows
 * otherwise.
 */
function ExamResultsView({ examId, masterKey }: { examId: string; masterKey: Bytes }) {
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await getEnvelopeStore();
        const exam = await loadExamResults(store, masterKey, examId);
        if (cancelled) return;
        setState(exam ? { status: 'ready', exam, store } : { status: 'not-found' });
      } catch {
        if (!cancelled) setState({ status: 'error', message: "Couldn't load this exam." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, masterKey]);

  async function persist(exam: ExamResults, store: EnvelopeStore) {
    setSaveStatus('saving');
    try {
      await saveExamResults(store, masterKey, exam);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }

  function handleStudentsChange(students: StudentResult[]) {
    if (state.status !== 'ready') return;
    const updatedExam = { ...state.exam, students };
    setState({ ...state, exam: updatedExam });
    void persist(updatedExam, state.store);
  }

  if (state.status === 'loading') {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }
  if (state.status === 'not-found') {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">This exam couldn&rsquo;t be found.</p>
    );
  }
  if (state.status === 'error') {
    return <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>;
  }

  const breakdown = computeQuestionBreakdown(state.exam.students, state.exam.questionCount);
  const analytics = computeClassAnalytics(state.exam.students, state.exam.questionCount);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          {state.exam.title}
        </h1>
        <SaveStatusIndicator
          status={saveStatus}
          onRetry={() => state.status === 'ready' && void persist(state.exam, state.store)}
        />
      </div>
      <ResultsGrid
        students={state.exam.students}
        questionCount={state.exam.questionCount}
        onChange={handleStudentsChange}
      />
      <QuestionBreakdownView breakdown={breakdown} />
      <ClassAnalyticsView analytics={analytics} />
    </div>
  );
}

export default function ExamResultsClient({ examId }: { examId: string }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- this codebase deliberately never uses next/link's client-side routing (see new-exam-client.tsx's own window.location.href precedent); every navigation is a plain hard link/redirect. */}
      <a href="/exams" className="text-sm text-emerald-600 hover:underline dark:text-emerald-400">
        ← All exams
      </a>
      <RequireMasterKey unlockDescription="Enter your Encryption Passphrase to view this exam.">
        {(masterKey) => <ExamResultsView examId={examId} masterKey={masterKey} />}
      </RequireMasterKey>
    </div>
  );
}

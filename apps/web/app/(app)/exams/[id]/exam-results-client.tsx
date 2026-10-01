'use client';

import { useEffect, useState } from 'react';
import { getEnvelopeStore } from '@/lib/storage/envelope-store';
import type { EnvelopeStore } from '@/lib/storage/envelope-store';
import { loadExamResults, saveExamResults } from '@/lib/exams/exam-results';
import type { ExamResults, StudentResult } from '@/lib/exams/exam-results';
import { computeQuestionBreakdown } from '@/lib/exams/question-breakdown';
import type { QuestionBreakdown } from '@/lib/exams/question-breakdown';
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

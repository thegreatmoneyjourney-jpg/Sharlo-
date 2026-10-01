'use client';

import { useEffect, useState } from 'react';
import { getEnvelopeStore } from '@/lib/storage/envelope-store';
import { listExamResults } from '@/lib/exams/exam-results';
import type { ExamResults } from '@/lib/exams/exam-results';
import type { Bytes } from '@/lib/crypto/encoding';
import { RequireMasterKey } from '../require-master-key';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; exams: ExamResults[] };

function ExamsList({ masterKey }: { masterKey: Bytes }) {
  const [state, setState] = useState<ListState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await getEnvelopeStore();
        const exams = await listExamResults(store, masterKey);
        if (!cancelled) {
          setState({
            status: 'ready',
            exams: [...exams].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          });
        }
      } catch {
        if (!cancelled) setState({ status: 'error', message: "Couldn't load your exams." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [masterKey]);

  if (state.status === 'loading') {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading your exams…</p>;
  }
  if (state.status === 'error') {
    return <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>;
  }
  if (state.exams.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No saved exams yet — scan one to see it here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {state.exams.map((exam) => (
        <li key={exam.recordId}>
          <a
            href={`/exams/${exam.recordId}`}
            className="flex items-center justify-between rounded-md border border-zinc-200 px-4 py-3 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{exam.title}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {new Date(exam.createdAt).toLocaleDateString()} · {exam.students.length} student
              {exam.students.length === 1 ? '' : 's'}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** `M3-008` — the minimal navigation surface proving exam persistence actually round-trips: without this, a saved exam would be unreachable except by directly knowing its envelope id. Not a dashboard — just enough to list and open what's been saved. */
export default function ExamsListClient() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Exams</h1>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- this codebase deliberately never uses next/link's client-side routing; every navigation is a plain hard link/redirect. */}
        <a
          href="/exams/new"
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          New exam
        </a>
      </div>
      <RequireMasterKey unlockDescription="Enter your Encryption Passphrase to view your saved exams.">
        {(masterKey) => <ExamsList masterKey={masterKey} />}
      </RequireMasterKey>
    </div>
  );
}

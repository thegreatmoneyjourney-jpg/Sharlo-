'use client';

import { useEffect, useState } from 'react';
import type { Bytes } from '@/lib/crypto/encoding';
import { fetchMySchools, type SchoolSummary } from '@/lib/api/schools-client';
import { loadSchoolWideExamResults } from '@/lib/exams/school-wide-results';
import { computeClassAnalytics } from '@/lib/exams/class-analytics';
import type { ExamResults } from '@/lib/exams/exam-results';
import { RequireMasterKey } from '../../require-master-key';

type LoadState =
  | { status: 'loading' }
  | { status: 'no-school' }
  | { status: 'error'; message: string }
  | { status: 'ready'; school: SchoolSummary; exams: ExamResults[] };

/**
 * `FR-SCHOOL-03`'s known-answers-only average, computed the same way
 * `class-analytics.ts`'s own per-student `correctPercent` already is —
 * reused rather than reimplemented, just averaged across students here
 * instead of ranked. `null` when no student in this exam has any known
 * (correct/incorrect) answer yet, same "no data to average" reasoning
 * `ClassAnalyticsView` already applies per-student/per-question.
 */
function overallAveragePercent(exam: ExamResults): number | null {
  const { weakestStudents } = computeClassAnalytics(exam.students, exam.questionCount);
  const known = weakestStudents.map((s) => s.correctPercent).filter((p): p is number => p !== null);
  if (known.length === 0) return null;
  return known.reduce((sum, p) => sum + p, 0) / known.length;
}

function SchoolResultsList({ masterKey }: { masterKey: Bytes }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const schools = await fetchMySchools();
        const school = schools[0];
        if (!school) {
          if (!cancelled) setState({ status: 'no-school' });
          return;
        }
        const exams = await loadSchoolWideExamResults(
          masterKey,
          school.driveLocationId,
          school.adminX25519PublicKey,
          school.adminX25519WrappedPrivateKey,
        );
        if (!cancelled) {
          setState({
            status: 'ready',
            school,
            exams: [...exams].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          });
        }
      } catch {
        if (!cancelled) {
          setState({ status: 'error', message: "Couldn't load your school's results." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [masterKey]);

  if (state.status === 'loading') {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading school results…</p>;
  }
  if (state.status === 'no-school') {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        You don&rsquo;t manage a school yet.{' '}
        <a
          href="/school/new"
          className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Create one
        </a>
        .
      </p>
    );
  }
  if (state.status === 'error') {
    return <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>;
  }
  if (state.exams.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No exams have been finalized under {state.school.name} yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {state.exams.map((exam) => {
        const average = overallAveragePercent(exam);
        return (
          <li
            key={exam.recordId}
            className="flex items-center justify-between rounded-md border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800"
          >
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{exam.title}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {new Date(exam.createdAt).toLocaleDateString()} · {exam.students.length} student
              {exam.students.length === 1 ? '' : 's'}
              {average !== null && ` · ${Math.round(average)}% average`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * `M3-017`/`FR-SCHOOL-04` — the principal dashboard: every exam finalized
 * by every teacher-under-school, decrypted client-side here in the
 * admin's own browser (`loadSchoolWideExamResults`) from the sealed
 * copies `M3-016` writes. Our backend is never in this decrypt path — it
 * only ever serves `GET /schools`' ciphertext/cleartext-but-non-secret
 * key material (`SchoolSummary.adminX25519*`) and Drive serves the
 * sealed file bytes; see `apps/api/scripts/check-no-decrypt-in-backend.mjs`
 * for the automated, CI-enforced proof (apps/api has no dependency
 * capable of opening a sealed box at all).
 *
 * Deliberately a flat list, not a per-exam drill-down page yet — the
 * sealed content carries no teacher-identifying field at all (nothing in
 * `FR-SCHOOL-*` asks for per-teacher attribution), and a full
 * breakdown/analytics detail view would need its own page (the existing
 * `/exams/[id]` page assumes *the signed-in teacher's own* envelope
 * store, a different decrypt path entirely) — a reasonable follow-up,
 * not built here. Matches `/exams`'s own "Not a dashboard — just enough
 * to list" MVP precedent (`M3-008`) before `M3-009` layered richer
 * analytics on afterward.
 */
export default function SchoolResultsClient() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">School results</h1>
      <RequireMasterKey unlockDescription="Enter your Encryption Passphrase to view your school's results.">
        {(masterKey) => <SchoolResultsList masterKey={masterKey} />}
      </RequireMasterKey>
    </div>
  );
}

'use client';

import {
  addBlankStudent,
  removeStudent,
  updateQuestionScore,
  updateStudentName,
  updateStudentRollNumber,
} from '@/lib/exams/results-grid-ops';
import type { StudentResult } from '@/lib/exams/exam-results';
import type { QuestionScore } from '@/lib/scanning/score-answers';
import { OUTCOME_LABELS } from '@/lib/exams/outcome-labels';

const CELL_INPUT_CLASSES =
  'w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
const HEADER_CELL_CLASSES =
  'whitespace-nowrap px-2 py-1.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400';
const BODY_CELL_CLASSES = 'px-2 py-1 align-middle';
const SECONDARY_BUTTON_CLASSES =
  'rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900';

/**
 * `M3-008`/`FR-IMPORT-06` — the reusable editable-grid component: name/
 * roll-number/per-question-mark editing plus row add/delete, scoped
 * tight to exactly that (not a general spreadsheet clone, per
 * `FR-IMPORT-06`'s own wording). This is the component's first call
 * site (`FR-RESULTS-01`, reviewing/correcting scanned results);
 * `M11`'s import-row-correction call site reuses this same component
 * against the identical `StudentResult[]` shape rather than a second
 * implementation.
 *
 * Every edit calls `onChange` with a brand-new array — this component
 * holds no state of its own, so the caller (`exam-results-client.tsx`)
 * is the single place that decides what happens next (re-encrypt and
 * re-save the whole exam, per this task's own "persists correctly"
 * requirement).
 */
export function ResultsGrid({
  students,
  questionCount,
  onChange,
}: {
  students: StudentResult[];
  questionCount: number;
  onChange: (students: StudentResult[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th scope="col" className={HEADER_CELL_CLASSES}>
                Name
              </th>
              <th scope="col" className={HEADER_CELL_CLASSES}>
                Roll number
              </th>
              {Array.from({ length: questionCount }, (_, i) => (
                <th key={i} scope="col" className={HEADER_CELL_CLASSES}>
                  Q{i + 1}
                </th>
              ))}
              <th scope="col" className={HEADER_CELL_CLASSES}>
                Total
              </th>
              <th scope="col" className={HEADER_CELL_CLASSES}>
                <span className="sr-only">Remove student</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => {
              const gradedCount = student.scored.scores.length - student.scored.excludedCount;
              return (
                <tr
                  key={student.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                >
                  <td className={BODY_CELL_CLASSES}>
                    <input
                      type="text"
                      aria-label="Student name"
                      value={student.name ?? ''}
                      onChange={(e) =>
                        onChange(updateStudentName(students, student.id, e.target.value))
                      }
                      className={CELL_INPUT_CLASSES}
                    />
                  </td>
                  <td className={BODY_CELL_CLASSES}>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label="Roll number"
                      value={student.rollNumber ?? ''}
                      onChange={(e) =>
                        onChange(updateStudentRollNumber(students, student.id, e.target.value))
                      }
                      className={CELL_INPUT_CLASSES}
                    />
                  </td>
                  {Array.from({ length: questionCount }, (_, i) => {
                    const outcome = student.scored.scores[i]?.outcome ?? 'needs-review';
                    return (
                      <td key={i} className={BODY_CELL_CLASSES}>
                        <select
                          aria-label={`Question ${i + 1} outcome`}
                          value={outcome}
                          onChange={(e) =>
                            onChange(
                              updateQuestionScore(
                                students,
                                student.id,
                                i,
                                e.target.value as QuestionScore['outcome'],
                              ),
                            )
                          }
                          className={CELL_INPUT_CLASSES}
                        >
                          {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                  <td
                    className={`${BODY_CELL_CLASSES} whitespace-nowrap text-zinc-700 dark:text-zinc-200`}
                  >
                    {student.scored.correctCount} / {gradedCount}
                  </td>
                  <td className={BODY_CELL_CLASSES}>
                    <button
                      type="button"
                      onClick={() => onChange(removeStudent(students, student.id))}
                      className="text-xs text-red-600 hover:underline dark:text-red-400"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => onChange(addBlankStudent(students, questionCount))}
        className={SECONDARY_BUTTON_CLASSES}
      >
        Add student
      </button>
    </div>
  );
}

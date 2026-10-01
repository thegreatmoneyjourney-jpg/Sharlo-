import ExcelJS from 'exceljs';
import type { ExamResults } from './exam-results';
import { OUTCOME_LABELS } from './outcome-labels';
import { buildCsv } from '../export/csv-writer';
import type { CsvCell } from '../export/csv-writer';
import { sanitizeCellValue } from '../export/sanitize';

/**
 * `M3-010` (`FR-RESULTS-04`) — export to CSV/Excel. Both formats share
 * this one row-building step (`buildExamExportRows`) so the two writers
 * can never silently drift into showing different data; only the
 * serialization differs. Mirrors `app/(app)/results-grid.tsx`'s own
 * columns exactly (same `OUTCOME_LABELS`, same "correct / graded"
 * tally) so a teacher sees identical numbers on screen and in the file.
 *
 * `ADR-0013` applies to every string column (name, roll number, each
 * question's outcome label) and never to the two numeric columns
 * (correct count, graded count) — the sanitizer is only ever called on
 * the former. Roll number is a string column on purpose, never written
 * as a native number: a scanned roll number can be zero-padded
 * (`M3-007`), and a real spreadsheet numeric cell would silently drop
 * that leading zero.
 */
export interface ExamExportRow {
  name: string;
  rollNumber: string;
  questionOutcomeLabels: string[];
  correctCount: number;
  gradedCount: number;
}

export function buildExamExportRows(exam: ExamResults): ExamExportRow[] {
  return exam.students.map((student) => ({
    name: student.name ?? '',
    rollNumber: student.rollNumber ?? '',
    questionOutcomeLabels: Array.from(
      { length: exam.questionCount },
      (_, i) => OUTCOME_LABELS[student.scored.scores[i]?.outcome ?? 'needs-review'],
    ),
    correctCount: student.scored.correctCount,
    gradedCount: student.scored.scores.length - student.scored.excludedCount,
  }));
}

function exportHeaders(questionCount: number): string[] {
  return [
    'Name',
    'Roll number',
    ...Array.from({ length: questionCount }, (_, i) => `Q${i + 1}`),
    'Correct',
    'Graded',
  ];
}

export function examResultsToCsv(exam: ExamResults): string {
  const headers = exportHeaders(exam.questionCount);
  const rows: CsvCell[][] = buildExamExportRows(exam).map((row) => [
    { type: 'string', value: row.name },
    { type: 'string', value: row.rollNumber },
    ...row.questionOutcomeLabels.map((label): CsvCell => ({ type: 'string', value: label })),
    { type: 'number', value: row.correctCount },
    { type: 'number', value: row.gradedCount },
  ]);
  return buildCsv(headers, rows);
}

/** Excel worksheet names can't contain `\ / * ? : [ ]`, can't be blank, and max out at 31 characters. */
function safeSheetName(title: string): string {
  const stripped = title.replace(/[\\/*?:[\]]/g, ' ').trim();
  return (stripped || 'Exam').slice(0, 31);
}

export async function examResultsToXlsxBuffer(exam: ExamResults): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(safeSheetName(exam.title));
  sheet.addRow(exportHeaders(exam.questionCount));
  for (const row of buildExamExportRows(exam)) {
    sheet.addRow([
      sanitizeCellValue(row.name),
      sanitizeCellValue(row.rollNumber),
      ...row.questionOutcomeLabels.map(sanitizeCellValue),
      row.correctCount,
      row.gradedCount,
    ]);
  }
  return workbook.xlsx.writeBuffer();
}

/** Strips characters invalid in a filename on any common OS, for the downloaded file's name. */
export function safeExportFilename(title: string, extension: 'csv' | 'xlsx'): string {
  const stripped = title.replace(/[\\/:*?"<>|]/g, ' ').trim();
  return `${stripped || 'exam'}.${extension}`;
}

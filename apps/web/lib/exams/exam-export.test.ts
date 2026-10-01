import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildExamExportRows,
  examResultsToCsv,
  examResultsToXlsxBuffer,
  safeExportFilename,
} from './exam-export';
import { parseCsv } from '../roster/parse-csv';
import type { ExamResults, StudentResult } from './exam-results';

function student(
  id: number,
  rollNumber: string | null,
  name: string | null,
  outcomes: StudentResult['scored']['scores'][number]['outcome'][],
): StudentResult {
  const scores = outcomes.map((outcome) => ({ outcome }));
  return {
    id,
    rollNumber,
    name,
    scored: {
      scores,
      correctCount: scores.filter((s) => s.outcome === 'correct').length,
      incorrectCount: scores.filter((s) => s.outcome === 'incorrect').length,
      needsReviewCount: scores.filter((s) => s.outcome === 'needs-review').length,
      excludedCount: scores.filter((s) => s.outcome === 'excluded').length,
    },
  };
}

function makeExam(students: StudentResult[], questionCount = 2): ExamResults {
  return {
    recordId: 'exam-1',
    title: 'Grade 8 quiz',
    questionCount,
    key: [],
    rosterId: null,
    students,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('buildExamExportRows', () => {
  it('maps each student to name, roll number, question outcome labels, and the correct/graded tally', () => {
    const exam = makeExam([student(1, '007', 'Alice', ['correct', 'incorrect'])]);
    expect(buildExamExportRows(exam)).toEqual([
      {
        name: 'Alice',
        rollNumber: '007',
        questionOutcomeLabels: ['Correct', 'Incorrect'],
        correctCount: 1,
        gradedCount: 2,
      },
    ]);
  });

  it('excludes an excluded question from the graded count', () => {
    const exam = makeExam([student(1, '1', 'Bob', ['correct', 'excluded'])]);
    expect(buildExamExportRows(exam)[0]).toMatchObject({ correctCount: 1, gradedCount: 1 });
  });

  it('falls back to an empty string for a null name/roll number', () => {
    const exam = makeExam([student(1, null, null, ['correct', 'correct'])]);
    expect(buildExamExportRows(exam)[0]).toMatchObject({ name: '', rollNumber: '' });
  });
});

describe('examResultsToCsv', () => {
  it('produces a header row and one row per student, parseable back by parseCsv', () => {
    const exam = makeExam([student(1, '007', 'Alice', ['correct', 'incorrect'])]);
    const csv = examResultsToCsv(exam);
    expect(parseCsv(csv)).toEqual([
      ['Name', 'Roll number', 'Q1', 'Q2', 'Correct', 'Graded'],
      ['Alice', '007', 'Correct', 'Incorrect', '1', '2'],
    ]);
  });

  it('sanitizes a formula-injection-shaped name but never touches the numeric columns', () => {
    const exam = makeExam([student(1, '1', '=cmd|calc', ['correct', 'correct'])]);
    const csv = examResultsToCsv(exam);
    const [, row] = parseCsv(csv);
    expect(row![0]).toBe("'=cmd|calc");
    expect(row![row!.length - 1]).toBe('2');
  });

  it('preserves a zero-padded roll number as a string, not a stripped number', () => {
    const exam = makeExam([student(1, '007', 'Alice', ['correct', 'correct'])]);
    const [, row] = parseCsv(examResultsToCsv(exam));
    expect(row![1]).toBe('007');
  });
});

describe('examResultsToXlsxBuffer', () => {
  it('produces a real, re-readable .xlsx workbook with the expected header and data rows', async () => {
    const exam = makeExam([student(1, '007', 'Alice', ['correct', 'incorrect'])]);
    const buffer = await examResultsToXlsxBuffer(exam);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.worksheets[0]!;
    const headerRow = sheet.getRow(1);
    const dataRow = sheet.getRow(2);
    const readCells = (row: typeof headerRow, count: number) =>
      Array.from({ length: count }, (_, i) => row.getCell(i + 1).value);

    expect(readCells(headerRow, 6)).toEqual([
      'Name',
      'Roll number',
      'Q1',
      'Q2',
      'Correct',
      'Graded',
    ]);
    expect(readCells(dataRow, 6)).toEqual(['Alice', '007', 'Correct', 'Incorrect', 1, 2]);
  });

  it('sanitizes a formula-injection-shaped string cell and keeps numeric cells as real numbers', async () => {
    const exam = makeExam([student(1, '1', '=cmd|calc', ['correct', 'correct'])]);
    const buffer = await examResultsToXlsxBuffer(exam);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const row = workbook.worksheets[0]!.getRow(2);
    expect(row.getCell(1).value).toBe("'=cmd|calc");
    expect(row.getCell(1).type).toBe(ExcelJS.ValueType.String);
    const correctCell = row.getCell(5);
    expect(correctCell.value).toBe(2);
    expect(correctCell.type).toBe(ExcelJS.ValueType.Number);
  });

  it('preserves a zero-padded roll number as a string cell, not a number cell', async () => {
    const exam = makeExam([student(1, '007', 'Alice', ['correct', 'correct'])]);
    const buffer = await examResultsToXlsxBuffer(exam);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const rollCell = workbook.worksheets[0]!.getRow(2).getCell(2);
    expect(rollCell.value).toBe('007');
    expect(rollCell.type).toBe(ExcelJS.ValueType.String);
  });

  it('sanitizes an exam title containing worksheet-invalid characters into a usable sheet name', async () => {
    const exam = { ...makeExam([]), title: 'Grade 8 / Section A?' };
    const buffer = await examResultsToXlsxBuffer(exam);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    expect(workbook.worksheets[0]!.name).toBe('Grade 8   Section A');
  });
});

describe('safeExportFilename', () => {
  it('appends the extension to the title', () => {
    expect(safeExportFilename('Grade 8 quiz', 'csv')).toBe('Grade 8 quiz.csv');
    expect(safeExportFilename('Grade 8 quiz', 'xlsx')).toBe('Grade 8 quiz.xlsx');
  });

  it('strips characters invalid in a filename', () => {
    expect(safeExportFilename('Midterm: Section/A*', 'csv')).toBe('Midterm  Section A.csv');
  });

  it('falls back to a generic name for an empty/all-invalid title', () => {
    expect(safeExportFilename('///', 'csv')).toBe('exam.csv');
  });
});

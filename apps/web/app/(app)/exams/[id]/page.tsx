import type { Metadata } from 'next';
import ExamResultsClient from './exam-results-client';

export const metadata: Metadata = {
  title: 'Exam results — Sharlo',
  robots: { index: false, follow: false },
};

export default async function ExamResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExamResultsClient examId={id} />;
}

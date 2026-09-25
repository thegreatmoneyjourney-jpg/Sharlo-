import type { Metadata } from 'next';
import NewExamClient from './new-exam-client';

export const metadata: Metadata = {
  title: 'Create exam — Sharlo',
  robots: { index: false, follow: false },
};

export default function NewExamPage() {
  return <NewExamClient />;
}

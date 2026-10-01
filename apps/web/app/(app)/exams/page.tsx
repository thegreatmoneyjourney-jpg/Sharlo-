import type { Metadata } from 'next';
import ExamsListClient from './exams-list-client';

export const metadata: Metadata = {
  title: 'Exams — Sharlo',
  robots: { index: false, follow: false },
};

export default function ExamsListPage() {
  return <ExamsListClient />;
}

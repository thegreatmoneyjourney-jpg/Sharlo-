import type { Metadata } from 'next';
import SchoolResultsClient from './school-results-client';

export const metadata: Metadata = {
  title: 'School results — Sharlo',
  robots: { index: false, follow: false },
};

export default function SchoolResultsPage() {
  return <SchoolResultsClient />;
}

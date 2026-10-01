import type { Metadata } from 'next';
import NewSchoolClient from './new-school-client';

export const metadata: Metadata = {
  title: 'Create your school — Sharlo',
  robots: { index: false, follow: false },
};

export default function NewSchoolPage() {
  return <NewSchoolClient />;
}

import type { Metadata } from 'next';
import ScanClient from './scan-client';

export const metadata: Metadata = {
  title: 'Scan — Sharlo',
  robots: { index: false, follow: false },
};

export default function ScanPage() {
  return <ScanClient />;
}

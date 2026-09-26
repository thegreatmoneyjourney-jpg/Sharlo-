import type { Metadata } from 'next';
import SettingsClient from './settings-client';

export const metadata: Metadata = {
  title: 'Settings — Sharlo',
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return <SettingsClient />;
}

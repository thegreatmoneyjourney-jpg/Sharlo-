import type { Metadata } from 'next';
import CustomTemplateClient from './custom-template-client';

export const metadata: Metadata = {
  title: 'Create custom template — Sharlo',
  robots: { index: false, follow: false },
};

export default function CustomTemplatePage() {
  return <CustomTemplateClient />;
}

import type { Metadata } from 'next';
import SignInClient from './signin-client';

export const metadata: Metadata = {
  title: 'Sign in — Sharlo',
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return <SignInClient />;
}

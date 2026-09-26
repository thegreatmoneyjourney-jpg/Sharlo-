'use client';

import { useState } from 'react';
import {
  requestEmailOtp,
  verifyEmailOtp,
  type VerifyEmailOtpOutcome,
} from '@/lib/api/email-otp-client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const PRIMARY_BUTTON_CLASSES =
  'rounded-md bg-emerald-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40';
const SECONDARY_BUTTON_CLASSES =
  'rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
const INPUT_CLASSES =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

function outcomeMessage(outcome: VerifyEmailOtpOutcome): string {
  switch (outcome) {
    case 'invalid_code':
      return 'That code is incorrect. Please try again.';
    case 'expired':
      return 'That code has expired. Request a new one below.';
    case 'too_many_attempts':
      return 'Too many incorrect attempts. Request a new code below.';
    case 'wrong_provider':
      return 'This email already has an account that signs in with Google. Use "Continue with Google" instead.';
    default:
      return 'That code looks invalid. Please check it and try again.';
  }
}

type LocalOnlyScreen = { screen: 'email' } | { screen: 'code'; email: string };

/**
 * `M3-005`/`FR-AUTH-01`/`FR-AUTH-06` — the product's first real sign-in
 * entry point (until now the only "sign in" link anywhere was a small
 * settings-page fallback for a session that had already lapsed). Two
 * paths: a direct link into the existing Google OAuth redirect flow
 * (`routes/auth.ts`, unchanged by this task), or local-only email+OTP,
 * ending in the exact same landing spot (`/settings`) the OAuth callback
 * already redirects to — that page already self-determines setup-vs-
 * change-passphrase mode, so this doesn't need to know which one applies.
 */
export default function SignInClient() {
  const [mode, setMode] = useState<'choice' | 'local-only'>('choice');
  const [localScreen, setLocalScreen] = useState<LocalOnlyScreen>({ screen: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestEmailOtp(email);
      setLocalScreen({ screen: 'code', email });
      setCode('');
    } catch {
      setError('Could not send a code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (localScreen.screen !== 'code') return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await verifyEmailOtp(localScreen.email, code);
      if (outcome === 'success') {
        window.location.href = '/settings';
        return;
      }
      setError(outcomeMessage(outcome));
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Sign in to Sharlo</h1>

      {mode === 'choice' && (
        <div className="flex flex-col gap-3">
          <a href={`${API_BASE_URL}/auth/google/start`} className={PRIMARY_BUTTON_CLASSES}>
            Continue with Google
          </a>
          <button
            type="button"
            onClick={() => setMode('local-only')}
            className={SECONDARY_BUTTON_CLASSES}
          >
            Continue without a Google account
          </button>
        </div>
      )}

      {mode === 'local-only' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Your data will be stored only in this browser, not Google Drive.
          </p>

          {localScreen.screen === 'email' && (
            <form onSubmit={handleRequestCode} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Email address
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={INPUT_CLASSES}
                />
              </label>
              <button type="submit" disabled={busy} className={PRIMARY_BUTTON_CLASSES}>
                {busy ? 'Sending…' : 'Send sign-in code'}
              </button>
            </form>
          )}

          {localScreen.screen === 'code' && (
            <form onSubmit={handleVerifyCode} className="flex flex-col gap-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                We sent a 6-digit code to <strong>{localScreen.email}</strong>.
              </p>
              <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Sign-in code
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className={INPUT_CLASSES}
                />
              </label>
              <button type="submit" disabled={busy} className={PRIMARY_BUTTON_CLASSES}>
                {busy ? 'Verifying…' : 'Verify code'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLocalScreen({ screen: 'email' });
                  setError(null);
                }}
                className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Use a different email or request a new code
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => {
              setMode('choice');
              setLocalScreen({ screen: 'email' });
              setError(null);
            }}
            className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Back
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

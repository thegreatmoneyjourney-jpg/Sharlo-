'use client';

import { useEffect, useState } from 'react';
import {
  fetchEncryptionParams,
  submitEncryptionSetup,
  submitPassphraseChange,
  submitRecoveryKeyReminderConfirm,
} from '@/lib/api/account-encryption-client';
import { fetchAccountInfo } from '@/lib/api/account-client';
import type { Argon2idParams } from '@/lib/crypto/argon2id';
import {
  rewrapMasterKeyByNewPassphrase,
  rewrapMasterKeyByNewRecoveryKey,
  setupEncryption,
  unwrapMasterKeyByPassphrase,
  type EncryptionSetupResult,
} from '@/lib/crypto/master-key';
import {
  evaluatePassphraseStrength,
  MIN_PASSPHRASE_LENGTH,
} from '@/lib/crypto/passphrase-strength';
import { RecoveryKeyRevealCard } from './recovery-key-reveal-card';
import { BackupCard } from './backup-card';

const PRIMARY_BUTTON_CLASSES =
  'rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40';
const INPUT_CLASSES =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

type PageState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'needs-setup' }
  | { status: 'setup-complete' }
  | {
      status: 'can-change-passphrase';
      stored: {
        wrappedMasterKeyByPassphrase: string;
        wrappedMasterKeyByRecovery: string;
        kdfSalt: string;
        kdfParams: Argon2idParams;
      };
    };

function PassphraseStrengthMeter({ passphrase }: { passphrase: string }) {
  if (!passphrase) return null;
  const { label, strength } = evaluatePassphraseStrength(passphrase);
  const color =
    strength === 'too-short' || strength === 'weak'
      ? 'text-red-600 dark:text-red-400'
      : strength === 'fair'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-600 dark:text-emerald-400';
  return <p className={`mt-1 text-xs ${color}`}>Passphrase strength: {label}</p>;
}

/**
 * FR-AUTH-03/04/05 first-time signup. Two steps: set the passphrase, then
 * see (and be forced to confirm saving) the Recovery Key — the Recovery
 * Key is generated as part of the SAME `setupEncryption()` call as the
 * passphrase wrap, so it can't be shown before a passphrase is chosen.
 */
function SetupFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<
    { name: 'enter-passphrase' } | { name: 'show-recovery-key'; result: EncryptionSetupResult }
  >({ name: 'enter-passphrase' });
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = evaluatePassphraseStrength(passphrase);
  const canContinue =
    strength.strength !== 'too-short' && passphrase === confirmPassphrase && !busy;

  async function handleChoosePassphrase() {
    setError(null);
    setBusy(true);
    try {
      const result = await setupEncryption(passphrase);
      setStep({ name: 'show-recovery-key', result });
    } catch {
      setError('Something went wrong generating your encryption keys. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmRecoveryKeySaved(result: EncryptionSetupResult) {
    setError(null);
    setBusy(true);
    try {
      await submitEncryptionSetup({
        wrappedMasterKeyByPassphrase: result.wrappedMasterKeyByPassphrase,
        wrappedMasterKeyByRecovery: result.wrappedMasterKeyByRecovery,
        kdfSalt: result.kdfSalt,
        kdfParams: result.kdfParams,
        recoveryKeyVerifier: result.recoveryKeyVerifier,
      });
      onDone();
    } catch {
      setError('Something went wrong saving your encryption setup. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (step.name === 'show-recovery-key') {
    const { result } = step;
    return (
      <RecoveryKeyRevealCard
        heading="Save your Recovery Key now — this is shown only once"
        description={
          <>
            Your student data is encrypted so that only you can read it — not even Sharlo can. If
            you forget your Encryption Passphrase, this Recovery Key is the <strong>only</strong>{' '}
            other way in.{' '}
            <strong>
              If you lose both your passphrase and this Recovery Key, your data is permanently
              unrecoverable
            </strong>{' '}
            — by anyone, including us. We&apos;ll remind you to reconfirm you still have it saved at
            7 and 30 days from now, but that reminder can&apos;t help if this copy is lost before
            then.
          </>
        }
        recoveryKeyDisplay={result.recoveryKeyDisplay}
        confirmedSaved={confirmedSaved}
        onConfirmedSavedChange={setConfirmedSaved}
        busy={busy}
        busyLabel="Saving…"
        continueLabel="Continue"
        error={error}
        onContinue={() => handleConfirmRecoveryKeySaved(result)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Choose an Encryption Passphrase. This is separate from your Google account and is never sent
        to our servers — only you will know it.
      </p>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Encryption Passphrase
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
          className={INPUT_CLASSES}
        />
      </label>
      <PassphraseStrengthMeter passphrase={passphrase} />

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Confirm passphrase
        <input
          type="password"
          value={confirmPassphrase}
          onChange={(e) => setConfirmPassphrase(e.target.value)}
          className={INPUT_CLASSES}
        />
      </label>
      {confirmPassphrase && passphrase !== confirmPassphrase && (
        <p className="text-xs text-red-600 dark:text-red-400">Passphrases don&apos;t match.</p>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        disabled={!canContinue}
        onClick={handleChoosePassphrase}
        className={PRIMARY_BUTTON_CLASSES}
      >
        {busy ? 'Generating…' : 'Continue'}
      </button>
    </div>
  );
}

/** FR-AUTH-07: re-wraps the master key under a new passphrase without touching any previously-encrypted data. */
function ChangePassphraseFlow({
  stored,
}: {
  stored: Extract<PageState, { status: 'can-change-passphrase' }>['stored'];
}) {
  const [currentPassphrase, setCurrentPassphrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmNewPassphrase, setConfirmNewPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = evaluatePassphraseStrength(newPassphrase);
  const canSubmit =
    currentPassphrase.length > 0 &&
    strength.strength !== 'too-short' &&
    newPassphrase === confirmNewPassphrase &&
    !busy;

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      const masterKey = await unwrapMasterKeyByPassphrase(currentPassphrase, stored);
      const rewrap = await rewrapMasterKeyByNewPassphrase(masterKey, newPassphrase);
      await submitPassphraseChange(rewrap);
      setDone(true);
    } catch {
      setError('Incorrect current passphrase, or something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-400">
        Your Encryption Passphrase has been updated. Your Recovery Key is unchanged and still works.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Current Encryption Passphrase
        <input
          type="password"
          value={currentPassphrase}
          onChange={(e) => setCurrentPassphrase(e.target.value)}
          className={INPUT_CLASSES}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        New Encryption Passphrase
        <input
          type="password"
          value={newPassphrase}
          onChange={(e) => setNewPassphrase(e.target.value)}
          placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
          className={INPUT_CLASSES}
        />
      </label>
      <PassphraseStrengthMeter passphrase={newPassphrase} />

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Confirm new passphrase
        <input
          type="password"
          value={confirmNewPassphrase}
          onChange={(e) => setConfirmNewPassphrase(e.target.value)}
          className={INPUT_CLASSES}
        />
      </label>
      {confirmNewPassphrase && newPassphrase !== confirmNewPassphrase && (
        <p className="text-xs text-red-600 dark:text-red-400">Passphrases don&apos;t match.</p>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={handleSubmit}
        className={PRIMARY_BUTTON_CLASSES}
      >
        {busy ? 'Updating…' : 'Change passphrase'}
      </button>
    </div>
  );
}

/**
 * `M3-004`/FR-AUTH-09 — the founder-required re-confirmation action behind
 * the reminder banner. Requires the current passphrase first (same
 * precondition as changing it: proves the teacher can still unwrap the
 * master key) because rotating the Recovery Key needs that master key.
 * Issues a *brand-new* Recovery Key rather than re-displaying the
 * original one — see `rotateRecoveryKey` (API) and
 * `rewrapMasterKeyByNewRecoveryKey` (crypto) for why that's the only thing
 * "re-confirm" can mean in a true zero-knowledge design.
 */
function ReconfirmRecoveryKeyFlow({
  stored,
}: {
  stored: Extract<PageState, { status: 'can-change-passphrase' }>['stored'];
}) {
  const [step, setStep] = useState<
    | { name: 'enter-passphrase' }
    | {
        name: 'show-new-recovery-key';
        recoveryKeyDisplay: string;
        wrappedMasterKeyByRecovery: string;
        recoveryKeyVerifier: string;
      }
    | { name: 'done' }
  >({ name: 'enter-passphrase' });
  const [currentPassphrase, setCurrentPassphrase] = useState('');
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerateNewRecoveryKey() {
    setError(null);
    setBusy(true);
    try {
      const masterKey = await unwrapMasterKeyByPassphrase(currentPassphrase, stored);
      const rotated = await rewrapMasterKeyByNewRecoveryKey(masterKey);
      setStep({ name: 'show-new-recovery-key', ...rotated });
    } catch {
      setError('Incorrect current passphrase, or something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmNewRecoveryKeySaved(fields: {
    wrappedMasterKeyByRecovery: string;
    recoveryKeyVerifier: string;
  }) {
    setError(null);
    setBusy(true);
    try {
      await submitRecoveryKeyReminderConfirm(fields);
      setStep({ name: 'done' });
    } catch {
      setError('Something went wrong saving your new Recovery Key. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (step.name === 'done') {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-400">
        Your Recovery Key has been confirmed. Your old Recovery Key no longer works — only the new
        one you just saved does.
      </p>
    );
  }

  if (step.name === 'show-new-recovery-key') {
    return (
      <RecoveryKeyRevealCard
        heading="Here's your new Recovery Key — save it now"
        description={
          <>
            Your old Recovery Key no longer works. This is shown only once —{' '}
            <strong>
              if you lose both your passphrase and this Recovery Key, your data is permanently
              unrecoverable
            </strong>
            , by anyone, including us.
          </>
        }
        recoveryKeyDisplay={step.recoveryKeyDisplay}
        confirmedSaved={confirmedSaved}
        onConfirmedSavedChange={setConfirmedSaved}
        busy={busy}
        busyLabel="Saving…"
        continueLabel="Confirm"
        error={error}
        onContinue={() =>
          handleConfirmNewRecoveryKeySaved({
            wrappedMasterKeyByRecovery: step.wrappedMasterKeyByRecovery,
            recoveryKeyVerifier: step.recoveryKeyVerifier,
          })
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Generate a new Recovery Key and confirm you&apos;ve saved it. Your old Recovery Key will
        stop working once you do.
      </p>
      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Confirm your Encryption Passphrase to continue
        <input
          type="password"
          value={currentPassphrase}
          onChange={(e) => setCurrentPassphrase(e.target.value)}
          className={INPUT_CLASSES}
        />
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        disabled={currentPassphrase.length === 0 || busy}
        onClick={handleGenerateNewRecoveryKey}
        className={PRIMARY_BUTTON_CLASSES}
      >
        {busy ? 'Generating…' : 'Generate a new Recovery Key'}
      </button>
    </div>
  );
}

/**
 * `M3-003` — the only authenticated page that exists yet (`auth.ts`'s
 * OAuth callback redirects here unconditionally). Self-determines which
 * flow to show from `GET /account/encryption-params` rather than the
 * server deciding for it, so a brand-new sign-in and a returning one both
 * land correctly in the same place. All actual cryptography (key
 * generation, wrapping, unwrapping) happens here in the browser via
 * `lib/crypto/master-key.ts` — this component only ever sends/receives
 * ciphertext and hex strings.
 */
export default function SettingsClient() {
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [isLocalOnly, setIsLocalOnly] = useState(false);

  // Independent of the encryption-params fetch below on purpose: whether
  // the Backup card renders doesn't depend on encryption-setup status
  // (`BackupCard`'s own doc comment), and a failure here (e.g. signed
  // out) shouldn't affect that flow's own state machine — soft-fail,
  // same as the account-wide banners.
  useEffect(() => {
    let cancelled = false;
    fetchAccountInfo()
      .then((info) => {
        if (!cancelled) setIsLocalOnly(info.authMode === 'local_only');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchEncryptionParams()
      .then((params) => {
        if (cancelled) return;
        if (!params.hasEncryptionSetup) {
          setState({ status: 'needs-setup' });
          return;
        }
        setState({
          status: 'can-change-passphrase',
          stored: {
            wrappedMasterKeyByPassphrase: params.wrappedMasterKeyByPassphrase!,
            wrappedMasterKeyByRecovery: params.wrappedMasterKeyByRecovery!,
            kdfSalt: params.kdfSalt!,
            kdfParams: params.kdfParams!,
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof Error && error.message.includes('401')) {
          setState({ status: 'signed-out' });
        } else {
          setState({ status: 'error', message: 'Could not load your account settings.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Encryption settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Your student data is encrypted with a key only you control.
        </p>
      </div>

      {state.status === 'loading' && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      )}

      {state.status === 'signed-out' && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          You need to{' '}
          <a href={`${API_BASE_URL}/auth/google/start`} className="text-emerald-600 underline">
            sign in
          </a>{' '}
          first.
        </p>
      )}

      {state.status === 'error' && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      )}

      {state.status === 'needs-setup' && (
        <SetupFlow onDone={() => setState({ status: 'setup-complete' })} />
      )}

      {state.status === 'setup-complete' && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          Encryption is set up. You&apos;re all done here — come back any time to change your
          passphrase.
        </p>
      )}

      {state.status === 'can-change-passphrase' && (
        <>
          <ChangePassphraseFlow stored={state.stored} />
          <div id="recovery-key" className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recovery Key</h2>
            <div className="mt-3">
              <ReconfirmRecoveryKeyFlow stored={state.stored} />
            </div>
          </div>
        </>
      )}

      {/* FR-AUTH-06: "available from the first session" — rendered for
          every non-loading/-signed-out/-error state, not just once
          encryption setup completes (import/export never touch the
          master key, so there's nothing to wait for). */}
      {isLocalOnly &&
        (state.status === 'needs-setup' ||
          state.status === 'setup-complete' ||
          state.status === 'can-change-passphrase') && <BackupCard />}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import type { Bytes } from '@/lib/crypto/encoding';
import { setupSchoolKeyMaterial } from '@/lib/crypto/school-key';
import { pickSharedDrive, type PickedSharedDrive } from '@/lib/drive/shared-drive-picker';
import { createSchoolFolder } from '@/lib/drive/school-folder';
import {
  fetchMySchools,
  submitCreateSchool,
  type DriveLocationType,
  type SchoolSummary,
} from '@/lib/api/schools-client';
import { RequireMasterKey } from '../../require-master-key';
import { SchoolMembersPanel } from './school-members-panel';

const PRIMARY_BUTTON_CLASSES =
  'rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40';
const SECONDARY_BUTTON_CLASSES =
  'rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900';
const INPUT_CLASSES =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'has-school'; school: SchoolSummary }
  | { status: 'ready' };

type AccountKind = 'workspace' | 'personal';

/**
 * `M3-014`/`ADR-0010` — school entity creation: name, Workspace-vs-personal
 * choice (self-reported, not detected via a privileged Drive API call —
 * see `shared-drive-picker.ts`'s own doc comment for why Shared-Drive
 * *creation* specifically needs the Picker, not a direct API call), the
 * Drive container, and the school key + admin X25519 keypair
 * (`lib/crypto/school-key.ts`). Gated behind `RequireMasterKey` — the key
 * material is real encrypted data, wrapped under the admin's master key,
 * exactly like any other feature that writes one.
 *
 * Directly-navigable (`/school/new`), not linked from anywhere yet — this
 * app has no real nav/header shell built (`M3-004`'s own CLAUDE.md note:
 * "building a real nav/header shell is separate, future work"), the same
 * situation `/exams/new`/`/signin` were each first reached through before
 * a shell existed.
 */
export default function NewSchoolClient() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-8">
      <RequireMasterKey unlockDescription="Creating a school protects its data with your Encryption Passphrase, the same way your own exam results already are.">
        {(masterKey) => <NewSchoolForm masterKey={masterKey} />}
      </RequireMasterKey>
    </div>
  );
}

function NewSchoolForm({ masterKey }: { masterKey: Bytes }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [name, setName] = useState('');
  const [accountKind, setAccountKind] = useState<AccountKind>('workspace');
  const [pickedDrive, setPickedDrive] = useState<PickedSharedDrive | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<SchoolSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const schools = await fetchMySchools();
        if (cancelled) return;
        setLoadState(
          schools[0] ? { status: 'has-school', school: schools[0] } : { status: 'ready' },
        );
      } catch {
        if (!cancelled) {
          setLoadState({ status: 'error', message: "Couldn't check your existing schools." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePickSharedDrive() {
    setPickerError(null);
    setPickerBusy(true);
    try {
      const drive = await pickSharedDrive();
      if (drive) setPickedDrive(drive);
    } catch {
      setPickerError("Couldn't open the Google Drive picker. Please try again.");
    } finally {
      setPickerBusy(false);
    }
  }

  function selectAccountKind(kind: AccountKind) {
    setAccountKind(kind);
    setPickedDrive(null);
    setPickerError(null);
  }

  const canSubmit =
    !submitting && name.trim().length > 0 && (accountKind === 'personal' || pickedDrive !== null);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const trimmedName = name.trim();
      let driveLocationType: DriveLocationType;
      let driveLocationId: string;
      if (accountKind === 'workspace') {
        driveLocationType = 'shared_drive';
        driveLocationId = pickedDrive!.id;
      } else {
        driveLocationType = 'folder';
        driveLocationId = await createSchoolFolder(trimmedName);
      }

      const keyMaterial = await setupSchoolKeyMaterial(masterKey);
      const school = await submitCreateSchool({
        name: trimmedName,
        driveLocationType,
        driveLocationId,
        ...keyMaterial,
      });
      setCreated(school);
    } catch {
      setSubmitError("Couldn't create your school. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadState.status === 'loading') {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }
  if (loadState.status === 'error') {
    return <p className="text-sm text-red-600 dark:text-red-400">{loadState.message}</p>;
  }
  if (loadState.status === 'has-school') {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            You already manage a school
          </h1>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{loadState.school.name}</p>
        </div>
        <SchoolMembersPanel school={loadState.school} />
      </div>
    );
  }
  if (created) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">School created</h1>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{created.name} is ready.</p>
        </div>
        <SchoolMembersPanel school={created} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Create your school</h1>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        School name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Riverside Academy"
          className={INPUT_CLASSES}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-zinc-700 dark:text-zinc-300">
          Where should your school&rsquo;s data live?
        </legend>
        <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="radio"
            name="account-kind"
            checked={accountKind === 'workspace'}
            onChange={() => selectAccountKind('workspace')}
            className="mt-0.5"
          />
          <span>
            I have Google Workspace for Education (or another Workspace account) —{' '}
            <strong>recommended</strong>. Your school&rsquo;s data survives any staff change,
            guaranteed.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="radio"
            name="account-kind"
            checked={accountKind === 'personal'}
            onChange={() => selectAccountKind('personal')}
            className="mt-0.5"
          />
          <span>
            I have a personal Google account. (Free Google Workspace for Education is available if
            your school qualifies — switching gives a stronger continuity guarantee than a personal
            account can.)
          </span>
        </label>
      </fieldset>

      {accountKind === 'workspace' && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handlePickSharedDrive}
            disabled={pickerBusy}
            className={SECONDARY_BUTTON_CLASSES}
          >
            {pickerBusy
              ? 'Opening Google Drive…'
              : pickedDrive
                ? `Selected: ${pickedDrive.name}`
                : 'Select or create a Shared Drive'}
          </button>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            If you don&rsquo;t have one yet, create a Shared Drive in Google Drive first, then
            select it here.
          </p>
          {pickerError && <p className="text-sm text-red-600 dark:text-red-400">{pickerError}</p>}
        </div>
      )}
      {accountKind === 'personal' && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          We&rsquo;ll create a Drive folder for your school&rsquo;s data automatically.
        </p>
      )}

      {submitError && <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={PRIMARY_BUTTON_CLASSES}
      >
        {submitting ? 'Creating…' : 'Create school'}
      </button>
    </div>
  );
}

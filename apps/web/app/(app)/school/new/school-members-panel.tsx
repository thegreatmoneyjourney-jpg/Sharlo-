'use client';

import { useEffect, useState } from 'react';
import {
  fetchSchoolMembers,
  submitAddTeacher,
  type SchoolMemberSummary,
  type SchoolSummary,
} from '@/lib/api/schools-client';
import { shareSchoolContainer } from '@/lib/drive/share-school-container';
import { removeTeacherFromSchool } from '@/lib/drive/remove-teacher-from-school';

const SECONDARY_BUTTON_CLASSES =
  'rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900';
const INPUT_CLASSES =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

/**
 * `M3-015`/`FR-SCHOOL-02` — the admin's "add a teacher" flow: the API call
 * creates the `school_members` row first (`addTeacherToSchool`'s own
 * `teacher_not_found`/`wrong_auth_provider`/`already_member` outcomes each
 * get a specific, correct message here, not one generic failure string),
 * and only once that succeeds does the admin's own browser share the Drive
 * container directly with Google (`shareSchoolContainer`, `ADR-0010`'s own
 * "Access-grant flow" step 2) — never the other way around, so a Drive
 * API hiccup can't leave a half-added teacher with no membership row to
 * retry against.
 *
 * This still isn't the *whole* access-grant flow — the teacher's own
 * one-time Picker step (`FR-SCHOOL-02`'s own second half, this task's
 * teacher-facing UI) is what actually completes it; a freshly-added
 * teacher shows "pending Drive access" here until they do.
 */
export function SchoolMembersPanel({ school }: { school: SchoolSummary }) {
  const [members, setMembers] = useState<SchoolMemberSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchSchoolMembers(school.id);
        if (!cancelled) setMembers(result);
      } catch {
        if (!cancelled) setLoadError("Couldn't load your teachers.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [school.id]);

  async function handleAddTeacher() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;
    setAddError(null);
    setAdding(true);
    try {
      const result = await submitAddTeacher(school.id, trimmedEmail);
      switch (result.outcome) {
        case 'added':
          // Update the list from the membership row that now genuinely
          // exists *before* attempting the Drive share, not after — if
          // the share call below fails, the teacher is still a real
          // member (the harder, already-committed step) and must not
          // silently disappear from view or get reported as "not added."
          setMembers((prev) => (prev ? [...prev, result.member] : [result.member]));
          setEmail('');
          try {
            await shareSchoolContainer(school.driveLocationId, trimmedEmail);
          } catch {
            setAddError(
              "Added, but couldn't share the Drive folder with them yet. Try again, or remove and re-add them.",
            );
          }
          break;
        case 'teacher_not_found':
          setAddError(
            'No Sharlo account exists for that email yet. Ask them to sign up first, then try again.',
          );
          break;
        case 'wrong_auth_provider':
          setAddError(
            'That account signed up without Google, so it has no Google Drive to share with. Ask them to sign in with Google instead.',
          );
          break;
        case 'already_member':
          setAddError('That teacher already belongs to a school.');
          break;
        case 'school_not_found':
          setAddError("Couldn't find your school. Please refresh and try again.");
          break;
      }
    } catch {
      setAddError("Couldn't add that teacher. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  /**
   * `M3-018`/`FR-SCHOOL-05` — runs the full remove sequence
   * (`lib/drive/remove-teacher-from-school.ts`: best-effort ownership
   * transfer on the folder path, then revoke, then delete the
   * membership row) and surfaces every outcome, including the
   * documented best-effort-transfer limitation, rather than reporting a
   * flat "removed" regardless of what actually happened.
   */
  async function handleRemoveTeacher(member: SchoolMemberSummary) {
    setRemovingId(member.id);
    setRemovalNotice(null);
    try {
      const outcome = await removeTeacherFromSchool(school, member);
      if (outcome.removed) {
        setMembers((prev) => (prev ? prev.filter((m) => m.id !== member.id) : prev));
      }
      const failedTransfers =
        outcome.transferResults?.filter((r) => r.outcome === 'transfer_failed') ?? [];
      if (failedTransfers.length > 0) {
        setRemovalNotice(
          `${member.email} was removed, but ownership of ${failedTransfers.length} file${failedTransfers.length === 1 ? '' : 's'} they still owned (e.g. "${failedTransfers[0]!.fileName}") couldn't be transferred automatically. This school stores data in a personal Drive folder, which only gives a best-effort continuity guarantee — see your school settings for details.`,
        );
      } else if (!outcome.removed) {
        setRemovalNotice(`${member.email} was already removed.`);
      }
    } catch {
      setRemovalNotice(`Couldn't remove ${member.email}. Please try again.`);
    } finally {
      setRemovingId(null);
      setConfirmingRemoveId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Teachers</h2>

      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      {removalNotice && (
        <p className="text-sm text-amber-700 dark:text-amber-400">{removalNotice}</p>
      )}
      {members && members.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No teachers added yet.</p>
      )}
      {members && members.length > 0 && (
        <ul className="flex flex-col gap-1">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex items-center justify-between gap-2 text-sm text-zinc-700 dark:text-zinc-300"
            >
              <span>{member.email}</span>
              <span className="flex items-center gap-2">
                {member.driveAccessGranted ? (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">connected</span>
                ) : (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    pending Drive access
                  </span>
                )}
                {confirmingRemoveId === member.id ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleRemoveTeacher(member)}
                      disabled={removingId === member.id}
                      className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
                    >
                      {removingId === member.id ? 'Removing…' : 'Confirm remove'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingRemoveId(null)}
                      disabled={removingId === member.id}
                      className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingRemoveId(member.id)}
                    className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
                  >
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Add a teacher by email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teacher@example.com"
          className={INPUT_CLASSES}
        />
      </label>
      {addError && <p className="text-sm text-red-600 dark:text-red-400">{addError}</p>}
      <button
        type="button"
        onClick={handleAddTeacher}
        disabled={adding || email.trim().length === 0}
        className={SECONDARY_BUTTON_CLASSES}
      >
        {adding ? 'Adding…' : 'Add teacher'}
      </button>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import type { Bytes } from '@/lib/crypto/encoding';
import { getEnvelopeStore } from '@/lib/storage/envelope-store';
import { listRosters, saveRoster } from '@/lib/roster/roster-store';
import { parseRosterCsv } from '@/lib/roster/roster';
import type { ParsedRosterCsv, Roster } from '@/lib/roster/roster';

const PRIMARY_BUTTON_CLASSES =
  'rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40';
const SECONDARY_BUTTON_CLASSES =
  'rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900';
const INPUT_CLASSES =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

type PickerState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rosters: Roster[] };

/**
 * `M3-007` (`FR-ROSTER-01`) — "upload a class list once per class,
 * reusable across exams." Deliberately inline in the exam-setup step
 * rather than a separate Class Management page (`M8`, not built yet) —
 * the feature-gating table's "ad-hoc, per-exam roster" framing is about
 * the *feature surface*, not a different data model; see
 * `lib/roster/roster.ts`'s own doc comment for the full reasoning. Only
 * ever rendered once the teacher opts in (`new-exam-client.tsx`'s "Add a
 * class list" toggle) and behind `RequireMasterKey` — a roster is real
 * encrypted data, so it needs the master key exactly like any other
 * feature that reads/writes one.
 */
export function RosterPicker({
  masterKey,
  onSelect,
}: {
  masterKey: Bytes;
  onSelect: (roster: Roster | null) => void;
}) {
  const [state, setState] = useState<PickerState>({ status: 'loading' });
  const [mode, setMode] = useState<'pick' | 'edit'>('pick');
  /** Non-null while `mode === 'edit'` means "replace this existing class's list" (reuses its `recordId`); null means "create a brand-new class." */
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string>('');
  const [className, setClassName] = useState('');
  const [csvPreview, setCsvPreview] = useState<ParsedRosterCsv | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await getEnvelopeStore();
        const rosters = await listRosters(store, masterKey);
        if (!cancelled) setState({ status: 'ready', rosters });
      } catch {
        if (!cancelled) setState({ status: 'error', message: "Couldn't load your class lists." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [masterKey]);

  async function handleFileChosen(file: File) {
    const text = await file.text();
    setCsvPreview(parseRosterCsv(text));
  }

  function startNewClass() {
    setEditingRecordId(null);
    setClassName('');
    setCsvPreview(null);
    setSaveError(null);
    setMode('edit');
  }

  function startReplacingSelected(roster: Roster) {
    setEditingRecordId(roster.recordId);
    setClassName(roster.className);
    setCsvPreview(null);
    setSaveError(null);
    setMode('edit');
  }

  async function handleSave() {
    if (!csvPreview || className.trim().length === 0 || csvPreview.entries.length === 0) return;
    setSaveError(null);
    setBusy(true);
    try {
      const store = await getEnvelopeStore();
      const roster: Roster = {
        recordId: editingRecordId ?? crypto.randomUUID(),
        className: className.trim(),
        entries: csvPreview.entries,
      };
      await saveRoster(store, masterKey, roster);
      setState((prev) =>
        prev.status !== 'ready'
          ? prev
          : {
              status: 'ready',
              rosters: editingRecordId
                ? prev.rosters.map((r) => (r.recordId === roster.recordId ? roster : r))
                : [...prev.rosters, roster],
            },
      );
      setSelectedRecordId(roster.recordId);
      setMode('pick');
      setCsvPreview(null);
      onSelect(roster);
    } catch {
      setSaveError("Couldn't save this class list. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading your class lists…</p>;
  }
  if (state.status === 'error') {
    return <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>;
  }

  if (mode === 'edit') {
    return (
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Class name
          <input
            type="text"
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            placeholder="e.g. Grade 8A"
            className={INPUT_CLASSES}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Class list CSV (roll number, student name)
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileChosen(file);
            }}
          />
        </label>
        {csvPreview && (
          <div className="rounded border border-zinc-300 p-2 text-xs dark:border-zinc-700">
            {csvPreview.skippedHeaderRow && (
              <p className="text-zinc-500 dark:text-zinc-400">
                Skipped header row: {csvPreview.skippedHeaderRow.join(', ')}
              </p>
            )}
            <p className="text-zinc-700 dark:text-zinc-300">
              {csvPreview.entries.length} student{csvPreview.entries.length === 1 ? '' : 's'} found.
            </p>
            {csvPreview.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-red-600 dark:text-red-400">
                {csvPreview.errors.map((err, i) => (
                  <li key={i}>
                    Row {err.row}: {err.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('pick')}
            className={SECONDARY_BUTTON_CLASSES}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              busy ||
              className.trim().length === 0 ||
              !csvPreview ||
              csvPreview.entries.length === 0
            }
            onClick={handleSave}
            className={PRIMARY_BUTTON_CLASSES}
          >
            {busy ? 'Saving…' : 'Save class list'}
          </button>
        </div>
      </div>
    );
  }

  const selectedRoster = state.rosters.find((r) => r.recordId === selectedRecordId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Class
        <select
          value={selectedRecordId}
          onChange={(e) => {
            const recordId = e.target.value;
            setSelectedRecordId(recordId);
            onSelect(state.rosters.find((r) => r.recordId === recordId) ?? null);
          }}
          className={INPUT_CLASSES}
        >
          <option value="">None — skip rostering for this exam</option>
          {state.rosters.map((roster) => (
            <option key={roster.recordId} value={roster.recordId}>
              {roster.className} ({roster.entries.length})
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={startNewClass} className={SECONDARY_BUTTON_CLASSES}>
          Upload a new class list
        </button>
        {selectedRoster && (
          <button
            type="button"
            onClick={() => startReplacingSelected(selectedRoster)}
            className={SECONDARY_BUTTON_CLASSES}
          >
            Replace {selectedRoster.className}&rsquo;s list
          </button>
        )}
      </div>
    </div>
  );
}

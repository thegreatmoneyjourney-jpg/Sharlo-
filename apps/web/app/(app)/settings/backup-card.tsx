'use client';

import { useRef, useState } from 'react';
import {
  createBackupBlob,
  restoreBackupFromFile,
  type RestoreBackupResult,
} from '@/lib/storage/backup';

const PRIMARY_BUTTON_CLASSES =
  'rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40';
const SECONDARY_BUTTON_CLASSES =
  'rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';

function downloadBackup(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sharlo-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

type ImportState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'done'; result: RestoreBackupResult }
  | { status: 'error'; message: string };

/**
 * `FR-AUTH-06` — "Export backup file / Import backup file are available
 * from the first session," the local-only account's only way to move
 * data across devices or recover from a cleared browser (there's no
 * Drive to fall back to). Rendered unconditionally for a local-only
 * account regardless of encryption-setup status — neither operation
 * needs the master key, only `lib/storage/`'s already-encrypted
 * envelopes, so there's no reason to gate this behind setup completing.
 */
export function BackupCard() {
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importState, setImportState] = useState<ImportState>({ status: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setExportBusy(true);
    setExportError(null);
    try {
      downloadBackup(await createBackupBlob());
    } catch {
      setExportError('Could not create a backup file. Please try again.');
    } finally {
      setExportBusy(false);
    }
  }

  async function handleImportFile(file: File) {
    setImportState({ status: 'busy' });
    try {
      setImportState({ status: 'done', result: await restoreBackupFromFile(file) });
    } catch (error) {
      setImportState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not import that backup file.',
      });
    }
  }

  return (
    <div id="backup" className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Backup</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Your data lives only in this browser. Export a backup file regularly, and use it to restore
        your data on another device or after clearing browser data.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleExport}
          disabled={exportBusy}
          className={PRIMARY_BUTTON_CLASSES}
        >
          {exportBusy ? 'Preparing…' : 'Export backup file'}
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importState.status === 'busy'}
          className={SECONDARY_BUTTON_CLASSES}
        >
          {importState.status === 'busy' ? 'Importing…' : 'Import backup file'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleImportFile(file);
          }}
        />
      </div>

      {exportError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{exportError}</p>}
      {importState.status === 'done' && (
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
          Restored {importState.result.restored} record
          {importState.result.restored === 1 ? '' : 's'}
          {importState.result.skipped > 0 ? ` (${importState.result.skipped} skipped)` : ''}.
        </p>
      )}
      {importState.status === 'error' && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{importState.message}</p>
      )}
    </div>
  );
}

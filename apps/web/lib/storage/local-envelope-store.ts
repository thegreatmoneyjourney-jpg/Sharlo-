/**
 * `M3-005`/`FR-AUTH-06` — the IndexedDB half of `ARCHITECTURE.md` §7's
 * storage model: local-only accounts write the same encrypted JSON
 * envelope Drive mode writes, just to IndexedDB instead of Drive. This
 * module is a dumb, content-agnostic envelope store — it never decrypts
 * or interprets an envelope's payload, only persists/retrieves/lists/
 * deletes it by `recordId`, the same way Drive's own `appProperties`
 * tagging (`type`/`recordId`) lets the app find its own files without a
 * decrypt. What exactly an envelope's encrypted-payload fields look like
 * is deliberately NOT this module's concern (see the doc comment on
 * `StoredEnvelope` below) — whichever future task first writes a real
 * envelope (`M3-006` onward) owns that decision.
 *
 * No third-party IndexedDB wrapper: four operations over one object
 * store don't need one, and IndexedDB's callback API is thin enough to
 * promisify directly. Tested against `fake-indexeddb` (real IndexedDB
 * semantics, no browser needed), not mocked.
 */

const DB_NAME = 'sharlo-local';
const DB_VERSION = 1;
const STORE_NAME = 'envelopes';
const TYPE_INDEX_NAME = 'type';

/**
 * The three fields this module actually needs (`recordId` to key by,
 * `type` to index/filter by, `schemaVersion` because every envelope
 * `ARCHITECTURE.md` §7 describes has one) — everything else is whatever
 * shape the writer chose for its encrypted payload, which this store
 * never reads. Deliberately not typed against the doc's illustrative
 * `iv`/`ciphertext`/`authTag` split: that shape doesn't match the
 * *actual*, already-tested `aesGcmEncrypt`/`aesGcmDecrypt` primitives in
 * `../crypto/aes-gcm.ts`, which produce/expect one combined blob, not
 * three separate fields — a documentation/implementation mismatch found
 * while building this, flagged in `docs/reports/SHARLO-M3-005.md` rather
 * than silently guessed at, since nothing has actually written a real
 * envelope yet to force the resolution either way.
 */
export interface StoredEnvelope {
  schemaVersion: number;
  type: string;
  recordId: string;
  [key: string]: unknown;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'recordId' });
        store.createIndex(TYPE_INDEX_NAME, 'type', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open local storage'));
  });
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = fn(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Local storage request failed'));
    });
  } finally {
    db.close();
  }
}

/** Inserts a new envelope or overwrites an existing one with the same `recordId`. */
export async function putEnvelope(envelope: StoredEnvelope): Promise<void> {
  await runTransaction('readwrite', (store) => store.put(envelope));
}

/** `undefined` if no envelope with this `recordId` exists. */
export async function getEnvelope(recordId: string): Promise<StoredEnvelope | undefined> {
  return runTransaction('readonly', (store) => store.get(recordId));
}

export async function deleteEnvelope(recordId: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(recordId));
}

/** Every envelope of one `type` (e.g. all `examResults`) — the access pattern every future feature reading local-only data will actually want, not "everything, unfiltered." */
export async function listEnvelopesByType(type: string): Promise<StoredEnvelope[]> {
  return runTransaction('readonly', (store) => store.index(TYPE_INDEX_NAME).getAll(type));
}

/** Every envelope regardless of type — Export Backup's own need (`FR-AUTH-06`), not a general-purpose listing most features should reach for. */
export async function listAllEnvelopes(): Promise<StoredEnvelope[]> {
  return runTransaction('readonly', (store) => store.getAll());
}

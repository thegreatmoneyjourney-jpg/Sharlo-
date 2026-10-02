import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _configureSchoolContainerStoreForTests,
  _resetSchoolContainerStoreForTests,
  getSealedRecord,
  putSealedRecord,
  type SealedRecord,
} from '../storage/school-container-store';
import { generateX25519KeyPair } from '../crypto/x25519';
import { bytesToHex } from '../crypto/encoding';
import {
  sealExamResultsForSchool,
  unsealExamResultsForSchool,
  type ExamResults,
} from './exam-results';

/**
 * `M3-016`'s own literal done-when criterion: "the school-key copy
 * independently decrypts in a separate admin test session." Unlike
 * `exam-results.test.ts`'s own seal/unseal round-trip (real crypto, no
 * Drive involved) or `school-container-store.test.ts`'s own put/get
 * round-trip (real wire format, a generic ciphertext string, no real
 * crypto), this test exercises the *real* pipeline end to end: a
 * "teacher session" that only ever knows the admin's *public* key seals
 * and uploads; a completely separate "admin session" — constructed from
 * nothing but the admin's full keypair and a fresh download — opens it.
 * Only the Drive HTTP layer is faked (a real Drive account isn't
 * available in this sandbox, the same documented gap `M3-006`'s own
 * report already carries); the crypto and the storage module are both
 * the real, unmocked production code.
 */

function createFakeSchoolDrive() {
  const files = new Map<
    string,
    { parentFolderId: string; appProperties: Record<string, string>; record: SealedRecord }
  >();
  let nextId = 0;

  function parseMultipartJsonParts(body: string): [Record<string, unknown>, SealedRecord] {
    const parts = [...body.matchAll(/\r\n\r\n(\{.*?\})\r\n/g)].map((m) => JSON.parse(m[1]!));
    return [parts[0] as Record<string, unknown>, parts[1] as SealedRecord];
  }

  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(input.toString());
    const method = init.method ?? 'GET';

    // files.list
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = decodeURIComponent(url.searchParams.get('q') ?? '');
      const parent = q.match(/'([^']*)' in parents/)?.[1];
      const recordId = q.match(/key='recordId' and value='([^']*)'/)?.[1];
      const type = q.match(/key='type' and value='([^']*)'/)?.[1];
      let matches = [...files.entries()];
      if (parent !== undefined) matches = matches.filter(([, f]) => f.parentFolderId === parent);
      if (recordId !== undefined)
        matches = matches.filter(([, f]) => f.appProperties.recordId === recordId);
      if (type !== undefined) matches = matches.filter(([, f]) => f.appProperties.type === type);
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: matches.map(([id]) => ({ id })) }),
        text: async () => '',
      };
    }

    // files.get?alt=media
    if (url.pathname.startsWith('/drive/v3/files/') && method === 'GET') {
      const id = url.pathname.replace('/drive/v3/files/', '');
      const file = files.get(id);
      return {
        ok: true,
        status: 200,
        json: async () => file!.record,
        text: async () => '',
      };
    }

    // files.create (multipart upload, new file)
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const [metadata, record] = parseMultipartJsonParts(String(init.body));
      const id = `fake-file-${++nextId}`;
      files.set(id, {
        parentFolderId: (metadata.parents as string[])[0]!,
        appProperties: metadata.appProperties as Record<string, string>,
        record,
      });
      return { ok: true, status: 200, json: async () => ({ id }), text: async () => '' };
    }

    // files.update (multipart upload, existing file)
    if (url.pathname.startsWith('/upload/drive/v3/files/') && method === 'PATCH') {
      const id = url.pathname.replace('/upload/drive/v3/files/', '');
      const existing = files.get(id)!;
      const [metadata, record] = parseMultipartJsonParts(String(init.body));
      files.set(id, {
        parentFolderId: existing.parentFolderId,
        appProperties: metadata.appProperties as Record<string, string>,
        record,
      });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }

    throw new Error(`Unhandled fake Drive request: ${method} ${url.toString()}`);
  }) as unknown as typeof fetch;

  return { fetchImpl };
}

function makeExam(overrides: Partial<ExamResults> = {}): ExamResults {
  return {
    recordId: 'exam-dual-enc-1',
    title: 'Grade 8 — Chapter 4 quiz',
    questionCount: 2,
    key: [
      { outcome: 'answered', optionIndex: 0 },
      { outcome: 'answered', optionIndex: 1 },
    ],
    rosterId: null,
    students: [
      {
        id: 1,
        rollNumber: '7',
        name: 'Alice',
        scored: {
          scores: [],
          correctCount: 2,
          incorrectCount: 0,
          needsReviewCount: 0,
          excludedCount: 0,
        },
      },
    ],
    createdAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
}

const PARENT_FOLDER_ID = 'school-shared-folder-id';

beforeEach(() => {
  const { fetchImpl } = createFakeSchoolDrive();
  _configureSchoolContainerStoreForTests({ fetchImpl, getAccessToken: async () => 'fake-token' });
});

afterEach(() => {
  _resetSchoolContainerStoreForTests();
});

describe('school dual-encryption, end to end', () => {
  it("a teacher's sealed upload independently decrypts in a separate admin session", async () => {
    // The admin's keypair is generated once, as it would be at real
    // school creation (M3-014) — the teacher "session" below never
    // touches `adminKeyPair.privateKey` at all, only the public half.
    const adminKeyPair = await generateX25519KeyPair();
    const exam = makeExam();

    // --- "teacher session" ---
    const sealed = await sealExamResultsForSchool(bytesToHex(adminKeyPair.publicKey), exam);
    await putSealedRecord(PARENT_FOLDER_ID, sealed);

    // --- separate "admin session": starts from nothing but the
    // keypair and a fresh Drive download, never reuses `sealed` or
    // `exam` from the teacher session above directly ---
    const downloaded = await getSealedRecord(PARENT_FOLDER_ID, exam.recordId);
    expect(downloaded).toBeDefined();
    const decrypted = await unsealExamResultsForSchool(adminKeyPair, downloaded!);

    expect(decrypted).toEqual(exam);
  });

  it("a different school admin (wrong keypair) cannot decrypt another school's uploaded copy", async () => {
    const realAdminKeyPair = await generateX25519KeyPair();
    const otherAdminKeyPair = await generateX25519KeyPair();
    const exam = makeExam();

    const sealed = await sealExamResultsForSchool(bytesToHex(realAdminKeyPair.publicKey), exam);
    await putSealedRecord(PARENT_FOLDER_ID, sealed);

    const downloaded = await getSealedRecord(PARENT_FOLDER_ID, exam.recordId);
    await expect(unsealExamResultsForSchool(otherAdminKeyPair, downloaded!)).rejects.toThrow();
  });

  it('re-saving the same exam (an edit) overwrites the school copy in place, never duplicating it', async () => {
    const adminKeyPair = await generateX25519KeyPair();
    const original = makeExam();
    const edited = makeExam({ students: [{ ...original.students[0]!, name: 'Alicia' }] });

    await putSealedRecord(
      PARENT_FOLDER_ID,
      await sealExamResultsForSchool(bytesToHex(adminKeyPair.publicKey), original),
    );
    await putSealedRecord(
      PARENT_FOLDER_ID,
      await sealExamResultsForSchool(bytesToHex(adminKeyPair.publicKey), edited),
    );

    const downloaded = await getSealedRecord(PARENT_FOLDER_ID, original.recordId);
    const decrypted = await unsealExamResultsForSchool(adminKeyPair, downloaded!);
    expect(decrypted.students[0]?.name).toBe('Alicia');
  });
});

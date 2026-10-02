import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _configureSchoolContainerStoreForTests,
  _resetSchoolContainerStoreForTests,
  putSealedRecord,
} from '../storage/school-container-store';
import { generateX25519KeyPair } from '../crypto/x25519';
import { bytesToHex, type Bytes } from '../crypto/encoding';
import { aesGcmEncrypt } from '../crypto/aes-gcm';
import { sealExamResultsForSchool, type ExamResults } from './exam-results';
import { loadSchoolWideExamResults } from './school-wide-results';

/**
 * `M3-017` — same faithful in-memory Drive fake
 * `school-result-dual-encryption.e2e.test.ts` (`M3-016`) already
 * established, reused here rather than copied-and-diverged: real
 * (unmocked) X25519 crypto, a real multipart-wire-format parser, real
 * per-parent-folder file tracking. Simulates *multiple* teachers writing
 * into the *same* shared container, then the admin's one dashboard fetch
 * reading all of them back — the actual shape `FR-SCHOOL-04` describes.
 */
function createFakeSchoolDrive() {
  const files = new Map<
    string,
    { parentFolderId: string; appProperties: Record<string, string>; record: unknown }
  >();
  let nextId = 0;

  function parseMultipartJsonParts(body: string): [Record<string, unknown>, unknown] {
    const parts = [...body.matchAll(/\r\n\r\n(\{.*?\})\r\n/g)].map((m) => JSON.parse(m[1]!));
    return [parts[0] as Record<string, unknown>, parts[1]];
  }

  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(input.toString());
    const method = init.method ?? 'GET';

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

    if (url.pathname.startsWith('/drive/v3/files/') && method === 'GET') {
      const id = url.pathname.replace('/drive/v3/files/', '');
      return {
        ok: true,
        status: 200,
        json: async () => files.get(id)!.record,
        text: async () => '',
      };
    }

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

    throw new Error(`Unhandled fake Drive request: ${method} ${url.toString()}`);
  }) as unknown as typeof fetch;

  return { fetchImpl };
}

function makeExam(overrides: Partial<ExamResults> = {}): ExamResults {
  return {
    recordId: 'exam-1',
    title: 'Chapter 4 quiz',
    questionCount: 1,
    key: [{ outcome: 'answered', optionIndex: 0 }],
    rosterId: null,
    students: [],
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

/** The admin's own wrapped private key, exactly as it round-trips through `SchoolSummary.adminX25519WrappedPrivateKey`. */
async function wrapAdminPrivateKey(masterKey: Bytes, privateKey: Bytes): Promise<string> {
  const wrapped = await aesGcmEncrypt(masterKey, privateKey);
  return bytesToHex(wrapped);
}

describe('loadSchoolWideExamResults', () => {
  it('unwraps the admin private key and decrypts every sealed exam in the shared container, from multiple teachers', async () => {
    const adminKeyPair = await generateX25519KeyPair();
    const masterKey = crypto.getRandomValues(new Uint8Array(32));
    const adminWrappedPrivateKeyHex = await wrapAdminPrivateKey(masterKey, adminKeyPair.privateKey);

    const examA = makeExam({ recordId: 'exam-a', title: 'Quiz A' });
    const examB = makeExam({ recordId: 'exam-b', title: 'Quiz B' });
    // Two different "teacher sessions" writing into the same shared
    // container — neither needs the admin's private key, only the public half.
    await putSealedRecord(
      PARENT_FOLDER_ID,
      await sealExamResultsForSchool(bytesToHex(adminKeyPair.publicKey), examA),
    );
    await putSealedRecord(
      PARENT_FOLDER_ID,
      await sealExamResultsForSchool(bytesToHex(adminKeyPair.publicKey), examB),
    );

    const results = await loadSchoolWideExamResults(
      masterKey,
      PARENT_FOLDER_ID,
      bytesToHex(adminKeyPair.publicKey),
      adminWrappedPrivateKeyHex,
    );

    expect(results.map((r) => r.title).sort()).toEqual(['Quiz A', 'Quiz B']);
  });

  it('returns an empty array when the school has no sealed exams yet', async () => {
    const adminKeyPair = await generateX25519KeyPair();
    const masterKey = crypto.getRandomValues(new Uint8Array(32));
    const adminWrappedPrivateKeyHex = await wrapAdminPrivateKey(masterKey, adminKeyPair.privateKey);

    const results = await loadSchoolWideExamResults(
      masterKey,
      PARENT_FOLDER_ID,
      bytesToHex(adminKeyPair.publicKey),
      adminWrappedPrivateKeyHex,
    );

    expect(results).toEqual([]);
  });

  it('fails to unwrap with the wrong master key, never returning partial/garbage output', async () => {
    const adminKeyPair = await generateX25519KeyPair();
    const masterKey = crypto.getRandomValues(new Uint8Array(32));
    const wrongMasterKey = crypto.getRandomValues(new Uint8Array(32));
    const adminWrappedPrivateKeyHex = await wrapAdminPrivateKey(masterKey, adminKeyPair.privateKey);

    await expect(
      loadSchoolWideExamResults(
        wrongMasterKey,
        PARENT_FOLDER_ID,
        bytesToHex(adminKeyPair.publicKey),
        adminWrappedPrivateKeyHex,
      ),
    ).rejects.toThrow();
  });
});

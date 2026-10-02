import { describe, expect, it } from 'vitest';
import {
  loadExamResults,
  listExamResults,
  saveExamResults,
  sealExamResultsForSchool,
  unsealExamResultsForSchool,
  SCHOOL_EXAM_RESULTS_SEALED_TYPE,
} from './exam-results';
import { bytesToHex } from '../crypto/encoding';
import { generateX25519KeyPair } from '../crypto/x25519';
import type { EnvelopeStore } from '../storage/envelope-store';
import type { StoredEnvelope } from '../storage/local-envelope-store';
import type { ExamResults } from './exam-results';

function createFakeStore(): EnvelopeStore {
  const envelopes = new Map<string, StoredEnvelope>();
  return {
    async putEnvelope(envelope) {
      envelopes.set(envelope.recordId, envelope);
    },
    async getEnvelope(recordId) {
      return envelopes.get(recordId);
    },
    async deleteEnvelope(recordId) {
      envelopes.delete(recordId);
    },
    async listEnvelopesByType(type) {
      return [...envelopes.values()].filter((e) => e.type === type);
    },
    async listAllEnvelopes() {
      return [...envelopes.values()];
    },
  };
}

function generateTestMasterKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

function makeExam(overrides: Partial<ExamResults> = {}): ExamResults {
  return {
    recordId: 'exam-1',
    title: 'Grade 8 — Chapter 4 quiz',
    questionCount: 20,
    key: Array.from({ length: 20 }, () => ({ outcome: 'answered' as const, optionIndex: 0 })),
    rosterId: null,
    students: [
      {
        id: 1,
        rollNumber: '7',
        name: 'Alice',
        scored: {
          scores: [],
          correctCount: 0,
          incorrectCount: 0,
          needsReviewCount: 0,
          excludedCount: 0,
        },
      },
    ],
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('exam-results store', () => {
  it('round-trips a saved exam through loadExamResults', async () => {
    const store = createFakeStore();
    const masterKey = generateTestMasterKey();
    const exam = makeExam();

    await saveExamResults(store, masterKey, exam);
    const loaded = await loadExamResults(store, masterKey, 'exam-1');

    expect(loaded).toEqual(exam);
  });

  it('returns undefined for a recordId with no saved exam', async () => {
    const store = createFakeStore();
    expect(await loadExamResults(store, generateTestMasterKey(), 'does-not-exist')).toBeUndefined();
  });

  it('overwrites an existing exam in place on re-save (same recordId)', async () => {
    const store = createFakeStore();
    const masterKey = generateTestMasterKey();
    const original = makeExam();
    const updated: ExamResults = {
      ...original,
      students: [{ ...original.students[0]!, name: 'Alicia' }],
    };

    await saveExamResults(store, masterKey, original);
    await saveExamResults(store, masterKey, updated);
    const exams = await listExamResults(store, masterKey);

    expect(exams).toEqual([updated]);
  });

  it('lists every saved exam, decrypted', async () => {
    const store = createFakeStore();
    const masterKey = generateTestMasterKey();
    const examA = makeExam({ recordId: 'a', title: 'Quiz A' });
    const examB = makeExam({ recordId: 'b', title: 'Quiz B' });

    await saveExamResults(store, masterKey, examA);
    await saveExamResults(store, masterKey, examB);
    const exams = await listExamResults(store, masterKey);

    expect(exams.sort((x, y) => x.recordId.localeCompare(y.recordId))).toEqual([examA, examB]);
  });

  it('fails to decrypt with the wrong master key', async () => {
    const store = createFakeStore();
    await saveExamResults(store, generateTestMasterKey(), makeExam());

    await expect(loadExamResults(store, generateTestMasterKey(), 'exam-1')).rejects.toThrow();
  });
});

describe('sealExamResultsForSchool / unsealExamResultsForSchool', () => {
  it('round-trips an exam through seal (teacher side) then unseal (admin side) with the matching keypair', async () => {
    const adminKeyPair = await generateX25519KeyPair();
    const exam = makeExam();

    const sealed = await sealExamResultsForSchool(bytesToHex(adminKeyPair.publicKey), exam);
    const unsealed = await unsealExamResultsForSchool(adminKeyPair, sealed);

    expect(unsealed).toEqual(exam);
  });

  it('tags the sealed record with the school-specific type, the recordId, and the current schema version', async () => {
    const adminKeyPair = await generateX25519KeyPair();
    const exam = makeExam({ recordId: 'exam-42' });

    const sealed = await sealExamResultsForSchool(bytesToHex(adminKeyPair.publicKey), exam);

    expect(sealed.type).toBe(SCHOOL_EXAM_RESULTS_SEALED_TYPE);
    expect(sealed.type).not.toBe('examResults'); // never confusable with the individual envelope's own type tag
    expect(sealed.recordId).toBe('exam-42');
    expect(sealed.schemaVersion).toBe(1);
  });

  it("never leaks the plaintext exam content into the sealed record's own ciphertext field", async () => {
    const adminKeyPair = await generateX25519KeyPair();
    const exam = makeExam({ title: 'a very distinctive exam title' });

    const sealed = await sealExamResultsForSchool(bytesToHex(adminKeyPair.publicKey), exam);

    expect(sealed.sealedCiphertext).toMatch(/^[0-9a-f]+$/i);
    expect(sealed.sealedCiphertext).not.toContain('distinctive');
  });

  it("fails to unseal with a different admin's keypair, never returning partial/garbage output", async () => {
    const realAdminKeyPair = await generateX25519KeyPair();
    const wrongAdminKeyPair = await generateX25519KeyPair();
    const sealed = await sealExamResultsForSchool(
      bytesToHex(realAdminKeyPair.publicKey),
      makeExam(),
    );

    await expect(unsealExamResultsForSchool(wrongAdminKeyPair, sealed)).rejects.toThrow();
  });
});

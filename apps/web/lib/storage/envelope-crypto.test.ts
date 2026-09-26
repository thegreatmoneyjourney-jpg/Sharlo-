import { describe, expect, it } from 'vitest';
import { decryptEnvelope, encryptEnvelope } from './envelope-crypto';

function randomMasterKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

describe('encryptEnvelope / decryptEnvelope', () => {
  it('round-trips arbitrary JSON-serializable content', async () => {
    const masterKey = randomMasterKey();
    const content = { studentName: 'Aisha', rollNumber: '17', marks: [1, 0, 1, 1] };

    const envelope = await encryptEnvelope(masterKey, 'examResults', 'record-1', content);
    const decrypted = await decryptEnvelope(masterKey, envelope);

    expect(decrypted).toEqual(content);
  });

  it('produces the expected envelope shape: schemaVersion, type, recordId, and a hex ciphertext', async () => {
    const masterKey = randomMasterKey();
    const envelope = await encryptEnvelope(masterKey, 'examResults', 'record-1', { a: 1 });

    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.type).toBe('examResults');
    expect(envelope.recordId).toBe('record-1');
    expect(envelope.ciphertext).toMatch(/^[0-9a-f]+$/i);
    // No separate iv/authTag fields — one combined blob, per this
    // module's own doc comment on why that's the resolution, not §7's
    // illustrative three-field split.
    expect(envelope.iv).toBeUndefined();
    expect(envelope.authTag).toBeUndefined();
  });

  it('never leaks the plaintext content into the envelope', async () => {
    const masterKey = randomMasterKey();
    const envelope = await encryptEnvelope(masterKey, 'examResults', 'record-1', {
      studentName: 'a very distinctive plaintext name',
    });

    expect(JSON.stringify(envelope)).not.toContain('a very distinctive plaintext name');
  });

  it('fails to decrypt with the wrong master key, never returning partial/garbage output', async () => {
    const envelope = await encryptEnvelope(randomMasterKey(), 'examResults', 'record-1', {
      a: 1,
    });
    await expect(decryptEnvelope(randomMasterKey(), envelope)).rejects.toThrow();
  });

  it('rejects an envelope missing its ciphertext field', async () => {
    const masterKey = randomMasterKey();
    await expect(
      decryptEnvelope(masterKey, { schemaVersion: 1, type: 'examResults', recordId: 'x' }),
    ).rejects.toThrow(/ciphertext/i);
  });
});

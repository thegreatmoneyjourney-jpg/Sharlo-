import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  decryptCredentialValue,
  encryptCredentialValue,
} from '../src/integrations/credential-store.js';

describe('credential-store: encrypt/decrypt (no DB needed)', () => {
  beforeEach(() => {
    process.env.INTEGRATION_CREDENTIALS_KEY = randomBytes(32).toString('base64');
  });

  it('round-trips a value through encrypt then decrypt', () => {
    const plaintext = 'not-a-real-secret-just-test-fixture-data';
    const encrypted = encryptCredentialValue(plaintext);
    expect(decryptCredentialValue(encrypted)).toBe(plaintext);
  });

  it('never stores the plaintext value as a readable substring of the ciphertext', () => {
    const plaintext = 'not-a-real-secret-just-test-fixture-data';
    const encrypted = encryptCredentialValue(plaintext);
    expect(encrypted.toString('utf8')).not.toContain(plaintext);
    expect(encrypted.toString('base64')).not.toContain(Buffer.from(plaintext).toString('base64'));
  });

  it('produces a different ciphertext each time (random IV), even for the same plaintext', () => {
    const plaintext = 'same-value-both-times';
    const first = encryptCredentialValue(plaintext);
    const second = encryptCredentialValue(plaintext);
    expect(first.equals(second)).toBe(false);
    expect(decryptCredentialValue(first)).toBe(plaintext);
    expect(decryptCredentialValue(second)).toBe(plaintext);
  });

  it('fails closed (throws) if the ciphertext is tampered with, rather than returning corrupted plaintext', () => {
    const encrypted = encryptCredentialValue('placeholder test value, not a real credential');
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptCredentialValue(tampered)).toThrow();
  });

  it('throws a clear error when INTEGRATION_CREDENTIALS_KEY is missing', () => {
    delete process.env.INTEGRATION_CREDENTIALS_KEY;
    expect(() => encryptCredentialValue('anything')).toThrow(/INTEGRATION_CREDENTIALS_KEY/);
  });

  it('throws a clear error when INTEGRATION_CREDENTIALS_KEY is the wrong length', () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptCredentialValue('anything')).toThrow(/32 bytes/);
  });
});

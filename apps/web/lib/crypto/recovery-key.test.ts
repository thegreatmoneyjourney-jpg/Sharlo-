/**
 * @vitest-environment node
 *
 * Needs real `crypto.subtle` (for `computeRecoveryKeyVerifier`'s SHA-256
 * digest) — jsdom doesn't implement it. See `aes-gcm.test.ts`'s docblock
 * comment for the confirming detail.
 */
import { describe, expect, it } from 'vitest';
import {
  computeRecoveryKeyVerifier,
  decodeRecoveryKeyFromDisplay,
  encodeRecoveryKeyForDisplay,
  generateRecoveryKey,
} from './recovery-key';

describe('generateRecoveryKey', () => {
  it('generates 32 bytes', () => {
    expect(generateRecoveryKey()).toHaveLength(32);
  });

  it('generates a different key every call', () => {
    expect(generateRecoveryKey()).not.toEqual(generateRecoveryKey());
  });
});

describe('encodeRecoveryKeyForDisplay / decodeRecoveryKeyFromDisplay', () => {
  it('round-trips a generated Recovery Key through display encoding and back', () => {
    const key = generateRecoveryKey();
    const display = encodeRecoveryKeyForDisplay(key);
    expect(decodeRecoveryKeyFromDisplay(display)).toEqual(key);
  });

  it('formats as hyphen-grouped hex', () => {
    const key = new Uint8Array(32).fill(0xab);
    const display = encodeRecoveryKeyForDisplay(key);
    expect(display).toBe(Array(16).fill('abab').join('-'));
  });

  it('tolerates a teacher retyping with different spacing/case than originally shown', () => {
    const key = generateRecoveryKey();
    const display = encodeRecoveryKeyForDisplay(key);
    const retyped = display.toUpperCase().replace(/-/g, ' ');
    expect(decodeRecoveryKeyFromDisplay(retyped)).toEqual(key);
  });

  it('throws clearly on a garbled/wrong-length Recovery Key rather than silently producing wrong bytes', () => {
    expect(() => decodeRecoveryKeyFromDisplay('abcd-1234')).toThrow(/32 bytes/);
  });

  it('throws clearly on non-hex garbage', () => {
    expect(() => decodeRecoveryKeyFromDisplay('not-a-recovery-key-at-all-nope')).toThrow();
  });
});

describe('computeRecoveryKeyVerifier', () => {
  it('is deterministic for the same key', async () => {
    const key = generateRecoveryKey();
    expect(await computeRecoveryKeyVerifier(key)).toBe(await computeRecoveryKeyVerifier(key));
  });

  it('differs for different keys', async () => {
    const a = await computeRecoveryKeyVerifier(generateRecoveryKey());
    const b = await computeRecoveryKeyVerifier(generateRecoveryKey());
    expect(a).not.toBe(b);
  });

  it('is a 64-character hex string (SHA-256)', async () => {
    const verifier = await computeRecoveryKeyVerifier(generateRecoveryKey());
    expect(verifier).toMatch(/^[0-9a-f]{64}$/);
  });
});

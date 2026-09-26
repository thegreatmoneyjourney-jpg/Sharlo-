import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from './encoding';

describe('bytesToHex / hexToBytes', () => {
  it('round-trips arbitrary bytes, including leading zero bytes (padding must not be dropped)', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x0f, 0xa0, 0xff, 0x00]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  it('produces lowercase, zero-padded hex', () => {
    expect(bytesToHex(new Uint8Array([0, 255, 16]))).toBe('00ff10');
  });

  it('accepts uppercase hex on decode', () => {
    expect(hexToBytes('00FF10')).toEqual(new Uint8Array([0, 255, 16]));
  });

  it('rejects an odd-length string', () => {
    expect(() => hexToBytes('abc')).toThrow(/hex/i);
  });

  it('rejects a string containing non-hex characters', () => {
    expect(() => hexToBytes('zzzz')).toThrow(/hex/i);
  });

  it('rejects an empty string', () => {
    expect(() => hexToBytes('')).toThrow(/hex/i);
  });
});

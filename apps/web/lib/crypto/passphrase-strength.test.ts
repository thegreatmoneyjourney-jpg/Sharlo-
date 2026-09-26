import { describe, expect, it } from 'vitest';
import { evaluatePassphraseStrength } from './passphrase-strength';

describe('evaluatePassphraseStrength', () => {
  it('flags anything under the minimum length as too-short, regardless of variety', () => {
    expect(evaluatePassphraseStrength('Ab1!').strength).toBe('too-short');
  });

  it('rates a long lowercase-only passphrase above weak (length dominates)', () => {
    const result = evaluatePassphraseStrength('correcthorsebatterystaple');
    expect(['good', 'strong']).toContain(result.strength);
  });

  it('rates a short-but-minimum-length, low-variety passphrase as weak', () => {
    expect(evaluatePassphraseStrength('aaaaaaaa').strength).toBe('weak');
  });

  it('rates a long, high-variety passphrase as strong', () => {
    expect(evaluatePassphraseStrength('Tr0ub4dor&3xtraLength!').strength).toBe('strong');
  });

  it('is monotonic: adding length to a passphrase never lowers its score', () => {
    const order: Record<string, number> = { 'too-short': 0, weak: 1, fair: 2, good: 3, strong: 4 };
    const short = evaluatePassphraseStrength('password');
    const longer = evaluatePassphraseStrength('passwordpasswordpassword');
    expect(order[longer.strength]).toBeGreaterThanOrEqual(order[short.strength]);
  });
});

/**
 * FR-AUTH-04's "strength meter shown" acceptance criterion. Deliberately a
 * simple, honest length+variety heuristic, not a rigorous entropy
 * estimate (a library like zxcvbn exists for that, and this app doesn't
 * depend on one for a first version) — length dominates real-world
 * passphrase entropy far more than character-class variety does (a long
 * ordinary-word passphrase beats a short "P@ssw0rd1"), so this weights
 * length first. This meter is a UX nudge only, never the actual security
 * boundary: Argon2id (`argon2id.ts`) is what protects a wrapped master key
 * against a weak passphrase, not this heuristic.
 */

export const MIN_PASSPHRASE_LENGTH = 8;

export type PassphraseStrength = 'too-short' | 'weak' | 'fair' | 'good' | 'strong';

export interface PassphraseStrengthResult {
  strength: PassphraseStrength;
  label: string;
}

export function evaluatePassphraseStrength(passphrase: string): PassphraseStrengthResult {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return {
      strength: 'too-short',
      label: `Too short (minimum ${MIN_PASSPHRASE_LENGTH} characters)`,
    };
  }

  const varietyCount = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((pattern) =>
    pattern.test(passphrase),
  ).length;

  let score = 0;
  if (passphrase.length >= 8) score += 1;
  if (passphrase.length >= 12) score += 1;
  if (passphrase.length >= 16) score += 1;
  if (varietyCount >= 3) score += 1;

  if (score <= 1) return { strength: 'weak', label: 'Weak' };
  if (score === 2) return { strength: 'fair', label: 'Fair' };
  if (score === 3) return { strength: 'good', label: 'Good' };
  return { strength: 'strong', label: 'Strong' };
}

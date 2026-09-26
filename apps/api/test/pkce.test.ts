import { describe, expect, it } from 'vitest';
import { deriveCodeChallenge, generateCodeVerifier, generateState } from '../src/auth/pkce.js';

describe('pkce', () => {
  it('generates a verifier in the RFC 7636 length range (43-128 chars) using the unreserved base64url charset', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates a different verifier every call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it('derives the same challenge from the same verifier every time (deterministic)', () => {
    const verifier = generateCodeVerifier();
    expect(deriveCodeChallenge(verifier)).toBe(deriveCodeChallenge(verifier));
  });

  it('derives different challenges from different verifiers', () => {
    expect(deriveCodeChallenge(generateCodeVerifier())).not.toBe(
      deriveCodeChallenge(generateCodeVerifier()),
    );
  });

  it("matches RFC 7636 Appendix B's worked example", () => {
    // https://www.rfc-editor.org/rfc/rfc7636#appendix-B
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(deriveCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generates a high-entropy state value distinct across calls', () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

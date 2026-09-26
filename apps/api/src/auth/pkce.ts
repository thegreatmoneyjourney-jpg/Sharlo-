import { createHash, randomBytes } from 'node:crypto';

/**
 * RFC 7636 (PKCE): a 32-byte random verifier, base64url-encoded (43 chars,
 * within the spec's 43-128 char range). `base64url` is a native Node
 * `Buffer` encoding (no manual `+/=` replacement needed).
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** S256 method: challenge = base64url(sha256(verifier)). */
export function deriveCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** A random, high-entropy value for the OAuth `state` parameter (CSRF for the redirect dance itself, distinct from the app's own session CSRF token). */
export function generateState(): string {
  return randomBytes(32).toString('base64url');
}

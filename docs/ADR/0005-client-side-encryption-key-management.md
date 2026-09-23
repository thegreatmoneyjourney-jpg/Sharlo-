# ADR-0005: Client-side key management — Encryption Passphrase + Recovery Key wrap a per-teacher master key

**Status:** Proposed — resolves a contradiction in the source spec; needs founder confirmation before M3 encryption work starts (see `docs/reports/SHARLO-M0-001.md`).

## Context

The kickoff prompt requires: a random master key per teacher, generated at account creation, used to encrypt all student data client-side; the master key wrapped two ways — "(a) by a key derived from the teacher's account password, and (b) by a one-time-displayed Recovery Key"; and "password change ⇒ only re-wrap the master key."

**The contradiction:** auth is Google OAuth only ("Sign in with Google"). There is no Sharlo account password for us to derive anything from — we never see one, by design (Google handles authentication). "A key derived from the account password" is therefore not implementable as literally written.

This is exactly the kind of thing the kickoff prompt asks to be flagged rather than silently resolved — see the top of `docs/reports/SHARLO-M0-001.md`.

## Decision (proposed)

Introduce a separate secret, the **Encryption Passphrase**, distinct from the teacher's Google login, set during signup (right after Google OAuth completes) and known only to the teacher — never transmitted to or stored by our servers in any recoverable form.

- At signup: client generates a random 256-bit master key. The teacher sets an Encryption Passphrase. Argon2id derives a wrapping key from the passphrase (+ a random per-account salt, stored server-side — the salt is not a secret). The master key is encrypted with this wrapping key → `wrapped_master_key_by_passphrase`, stored server-side as ciphertext.
- Simultaneously, a random Recovery Key is generated, shown once, and the teacher must actively confirm they've saved/downloaded/printed it. It independently wraps the same master key → `wrapped_master_key_by_recovery`, also stored as ciphertext.
- Either the Encryption Passphrase or the Recovery Key can unwrap the master key on a new device/browser.
- Changing the Encryption Passphrase re-derives the wrapping key and re-wraps only the small master-key blob — no historical data is touched, satisfying the spec's stated requirement exactly, just substituting "Encryption Passphrase" for "account password."

This is the same pattern used by other products that combine SSO-style login with end-to-end/zero-knowledge encryption (e.g., Bitwarden, Proton with SSO) for exactly this reason: an identity provider can authenticate you, but it can't hand your app secret client-side entropy the server never sees.

## Alternatives considered

- **Derive the wrapping key from the Google OAuth token/ID directly.** Rejected — tokens rotate and expire, aren't designed as stable secret entropy, and Google (or anyone who intercepts a token) would effectively be in the key-derivation path, undermining the "not even we can read it" claim's spirit even if not its letter.
- **WebAuthn/passkey PRF extension for key derivation.** Interesting future option, but browser/device support is inconsistent enough in the current landscape to be a risky sole mechanism for something as unforgiving as "lose this and your data is gone forever." Could be added later as a *third* optional unwrap path without breaking this design.
- **Drop the "account password" requirement and rely on the Recovery Key alone.** Rejected — that would mean every sign-in on a new device requires digging up the Recovery Key file, which is a poor everyday UX; a memorable passphrase for routine use plus the Recovery Key as a break-glass backup matches the spec's evident intent much more closely.

## Consequences

- A teacher who loses **both** the Encryption Passphrase and the Recovery Key has permanently unrecoverable data — this is inherent to true zero-knowledge encryption, not a bug, but it's a real support-burden and product-risk surface worth the founder's explicit awareness (flagged again in the M0 report). Recommend strong onboarding UX around saving the Recovery Key (SRS FR-AUTH-05) and considering (later, not v1) a way for a school admin to be a break-glass recovery path *for teachers under that school's account specifically*, using the same dual-encryption mechanism as ADR-0010 — not a backdoor for individual/non-school teachers.
- The passphrase is a second thing for a non-technical teacher to remember, beyond their Google login — a real UX cost, accepted as the price of the privacy guarantee actually being true rather than aspirational.
- This needs founder sign-off specifically because it's a deviation from the literal spec text, even though it preserves the spec's evident intent.

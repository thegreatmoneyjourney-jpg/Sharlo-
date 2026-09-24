# ADR-0005: Client-side key management — Encryption Passphrase + Recovery Key wrap a per-teacher master key

**Status:** Accepted — confirmed by founder (see `docs/reports/SHARLO-M0-007.md`). The design below is final. The founder additionally required a proactive Recovery Key reminder cadence beyond the signup-time confirmation described here; see the "Recovery Key reminder cadence" addendum at the end of this ADR and `docs/SRS.md` FR-AUTH-09.

## Context

The kickoff prompt requires: a random master key per teacher, generated at account creation, used to encrypt all student data client-side; the master key wrapped two ways — "(a) by a key derived from the teacher's account password, and (b) by a one-time-displayed Recovery Key"; and "password change ⇒ only re-wrap the master key."

**The contradiction:** auth is Google OAuth only ("Sign in with Google"). There is no Sharlo account password for us to derive anything from — we never see one, by design (Google handles authentication). "A key derived from the account password" is therefore not implementable as literally written.

This is exactly the kind of thing the kickoff prompt asks to be flagged rather than silently resolved — see the top of `docs/reports/SHARLO-M0-001.md`.

## Decision

Introduce a separate secret, the **Encryption Passphrase**, distinct from the teacher's Google login, set during signup (right after Google OAuth completes) and known only to the teacher — never transmitted to or stored by our servers in any recoverable form.

- At signup: client generates a random 256-bit master key. The teacher sets an Encryption Passphrase. Argon2id derives a wrapping key from the passphrase (+ a random per-account salt, stored server-side — the salt is not a secret). The master key is encrypted with this wrapping key → `wrapped_master_key_by_passphrase`, stored server-side as ciphertext.
- Simultaneously, a random Recovery Key is generated, shown once, and the teacher must actively confirm they've saved/downloaded/printed it. It independently wraps the same master key → `wrapped_master_key_by_recovery`, also stored as ciphertext.
- Either the Encryption Passphrase or the Recovery Key can unwrap the master key on a new device/browser.
- Changing the Encryption Passphrase re-derives the wrapping key and re-wraps only the small master-key blob — no historical data is touched, satisfying the spec's stated requirement exactly, just substituting "Encryption Passphrase" for "account password."

This is the same pattern used by other products that combine SSO-style login with end-to-end/zero-knowledge encryption (e.g., Bitwarden, Proton with SSO) for exactly this reason: an identity provider can authenticate you, but it can't hand your app secret client-side entropy the server never sees.

## Alternatives considered

- **Derive the wrapping key from the Google OAuth token/ID directly.** Rejected — tokens rotate and expire, aren't designed as stable secret entropy, and Google (or anyone who intercepts a token) would effectively be in the key-derivation path, undermining the "not even we can read it" claim's spirit even if not its letter.
- **WebAuthn/passkey PRF extension for key derivation.** Interesting future option, but browser/device support is inconsistent enough in the current landscape to be a risky sole mechanism for something as unforgiving as "lose this and your data is gone forever." Could be added later as a _third_ optional unwrap path without breaking this design.
- **Drop the "account password" requirement and rely on the Recovery Key alone.** Rejected — that would mean every sign-in on a new device requires digging up the Recovery Key file, which is a poor everyday UX; a memorable passphrase for routine use plus the Recovery Key as a break-glass backup matches the spec's evident intent much more closely.

## Consequences

- A teacher who loses **both** the Encryption Passphrase and the Recovery Key has permanently unrecoverable data — this is inherent to true zero-knowledge encryption, not a bug, but it's a real support-burden and product-risk surface worth the founder's explicit awareness (flagged again in the M0 report). Recommend strong onboarding UX around saving the Recovery Key (SRS FR-AUTH-05) and considering (later, not v1) a way for a school admin to be a break-glass recovery path _for teachers under that school's account specifically_, using the same dual-encryption mechanism as ADR-0010 — not a backdoor for individual/non-school teachers.
- The passphrase is a second thing for a non-technical teacher to remember, beyond their Google login — a real UX cost, accepted by the founder as the price of the privacy guarantee actually being true rather than aspirational (see `docs/reports/SHARLO-M0-007.md`).

## Addendum: Recovery Key reminder cadence (founder-required, added post-acceptance)

Self-reported confirmation at signup ("I've saved my Recovery Key") is a necessary but weak signal — it's well-established product behavior that users click through security-credential prompts without actually completing the underlying action, and even a genuine save at signup doesn't mean the file is still safely held 30 days later (devices get reset, downloads get cleared). The founder's explicit instruction: treat the signup-time click-through as a soft gate only, and proactively re-prompt until there's a real re-confirmation.

Design:

- `users` gains `recovery_key_issued_at`, `recovery_key_reminder_7d_sent_at`, `recovery_key_reminder_30d_sent_at`, and `recovery_key_reminder_dismissed_at` (all nullable timestamps).
- A daily scheduled job selects accounts where `recovery_key_reminder_dismissed_at IS NULL` and the relevant interval has elapsed since `recovery_key_issued_at`, and triggers **both** an in-app persistent banner and a transactional email (see ADR-0011) — email specifically because the at-risk population is disproportionately teachers who haven't logged back in, who an in-app-only nudge would never reach.
- The reminder flow requires an explicit re-confirmation action (re-download the Recovery Key + click "I've securely stored this") to set `recovery_key_reminder_dismissed_at` — a passive dismiss ("X" out of the banner) does not count and the reminder returns at the next interval.
- This does not change the underlying cryptography in this ADR at all — it's an onboarding/lifecycle UX requirement layered on top, tracked in `docs/SRS.md` FR-AUTH-09 and `docs/TASKS.md` M3-004.

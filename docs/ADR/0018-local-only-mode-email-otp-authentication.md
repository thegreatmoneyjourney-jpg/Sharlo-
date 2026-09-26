# ADR-0018: Email + OTP authentication for local-only mode

**Status:** Accepted — founder-confirmed 2026-09-26 (see `docs/reports/SHARLO-M3-005.md`).

## Context

`FR-AUTH-06` (local-only mode) lets a teacher use Sharlo with no Google account — but every account-level mechanism built so far (`M3-001`–`M3-004`) is Google-OAuth-specific: `users.google_sub` is how a returning teacher is recognized, and session issuance happens only at the end of the OAuth callback. A local-only teacher still plausibly needs an account relationship with our server for the (B)-side concerns `ARCHITECTURE.md` §2's system-map diagram describes (billing/subscription tier, free-tier usage counters, non-sensitive template storage) — the architectural line that local-only mode actually draws is about (A)-side data (student/exam content: Drive vs. IndexedDB), not about having no server relationship at all.

This is a real gap, not a minor detail: without an identity provider, there is no OAuth token to exchange and no existing mechanism to authenticate a brand-new local-only signup, or to recognize the same teacher on a later visit. `users.email` is `NOT NULL UNIQUE`, which a Google account satisfies for free (Google's own verified email) but a local-only account has no equivalent for unless the product asks for one directly.

## Decision

Local-only accounts authenticate via **passwordless email + one-time code (OTP)** — not a password (this product never stores one, for either provider, by design), and not Google OAuth.

- **`users.auth_provider`** (new column: `'google' | 'email_otp'`) records how a given account authenticates, independent of `users.auth_mode` (`'google' | 'local_only'`, unchanged — that column is about where the account's _student data_ lives, per `ARCHITECTURE.md` §2). Today the two are 1:1 (`google`↔`google`, `local_only`↔`email_otp`), but keeping them as separate columns is deliberate — see "Future: account linking" below.
- **`users.email` stays `NOT NULL UNIQUE`, unchanged.** Both providers need a real address: Google's own OAuth-verified email for one, the address a code is actually sent to for the other.
- **A new `email_otp_codes` table** — one row per requested code: `email`, a **hash** of the code (never the raw code at rest — the same "don't store a sensitive value in the clear when avoidable" instinct as `recovery_key_verifier`, though here it's genuine defense-in-depth on top of the real protection, which is expiry + attempt-count + rate limiting, not the hash's own strength against a 6-digit space), `expires_at` (10 minutes), `attempts` (capped, e.g. 5), `consumed_at` (nullable — sets once successfully verified, so the same code can't be replayed), `created_at`.
- **Two new endpoints, both rate-limited** (`NFR-SEC-04` — "rate limiting... on all backend endpoints" already requires this; this is that requirement's first concrete implementation in this codebase, not a bespoke OTP-only exception) — see the task report for the exact library/thresholds chosen:
  - `POST /auth/email-otp/request` — accepts an email, mints a code, and emails it via the same `EmailSender` interface `M3-004` already built (no new email-sending mechanism). Deliberately never touches the `users` table at all — whether the email already has an account must stay invisible to the caller (no enumeration signal), so account lookup/creation is entirely deferred to `/verify`.
  - `POST /auth/email-otp/verify` — accepts an email + code, checks it against the stored hash/expiry/attempts, and only on success finds-or-creates the `users` row (`auth_provider='email_otp'`) and calls the exact same `createSession` function the Google OAuth callback already calls. An email already registered under a _different_ provider is refused (not silently linked or duplicated) — see "Future: account linking" below.
- **Session issuance converges to one mechanism regardless of provider.** A session, once issued, carries no memory of which provider created it — `sessions`' own schema and RLS policies (`M3-001`/`M3-002`) are already provider-agnostic (scoped by `user_id`, not by how that user authenticated), so this requires no changes there. Every downstream consumer (billing, entitlement checks, RLS policies, the encryption-setup routes from `M3-003`) already only ever looks at `session.userId` — none of it branches on how the session came to exist, and none of it should ever need to.

## Alternatives considered

- **A device-bound credential (e.g., a long-lived local secret minted at signup, presented like a bearer token).** Rejected — harder to reason about securely than a well-understood, standard email-OTP flow, and doesn't solve the "prove you're a real, reachable person for later account-recovery/billing contact" problem an email address solves for free.
- **Make `users.email` nullable, generate an internal placeholder for local-only accounts.** Rejected — every account still benefits from a real, reachable email (support, billing receipts, the `M3-004` reminder-cadence emails), and a nullable-email schema would need special-casing throughout the app (billing lookups, admin panel, support tooling) for a case that's better solved by just asking for an email once at signup.
- **Traditional password.** Rejected outright and consistently with this project's whole approach to auth (`ADR-0005`'s own reasoning): a password is one more secret to manage server-side (hashing, reset flows, breach exposure) for a product that has deliberately avoided that surface everywhere else.

## Consequences

- Two new, real attack surfaces this project didn't have before: an email-enumeration angle (does requesting a code for an arbitrary email leak whether that email already has an account?) and OTP brute-force. Both are mitigated the same way any OTP system is — generic responses that don't reveal account existence, short expiry, a small attempt cap, and rate limiting on both endpoints — not a novel design, a standard one, deliberately.
- `M3-005`'s own report is where the concrete rate-limiting library/thresholds, the exact OTP code format, and the RLS policy shape for `email_otp_codes` (the same "purpose-scoped lookup GUC" pattern `sessions`/`users`' `google_sub` lookup already established in `M3-001`) are documented — this ADR fixes the _decision_, not the line-level implementation.

## Future: account linking (not built now)

A local-only teacher may later want to connect Google/Drive (e.g., their school lifts an IT policy blocking Drive) without losing their existing account, billing history, or encrypted local data. Keeping `auth_provider` as its own column (rather than collapsing it into `auth_mode`, or hard-coupling the two) is deliberately what keeps this option open — a future linking flow could add a `google_sub` to an existing `email_otp`-provider row (or vice versa) as an account-_linking_ operation, not a second, disconnected account for the same person. This ADR does not design that flow; it only avoids ruling it out.

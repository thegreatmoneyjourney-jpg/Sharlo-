# ADR-0017: Admin-managed integration credentials — encrypted at rest, no redeploy to rotate

**Status:** Accepted — founder directive (Addendum 3).

## Context

Every integration this product has (Resend, Paddle, Bank Alfalah, and now a pluggable AI provider for `ADR-0016`) needs a secret — an API key or equivalent — on the server side to actually call that provider. The obvious default, and what `M0-008`/`M4-003` would otherwise have done, is a plain environment variable read at process start.

The founder's explicit instruction: no integration credential is ever a hardcoded environment variable that requires a code change or redeploy to add, update, or rotate. Reasoning that generalizes beyond convenience: a solo founder operating this product needs to be able to rotate a leaked key, swap an AI provider, or add a new integration **immediately**, not queue up a deploy — and a `.env` file or CI secret is also one more place a credential can leak (committed by accident, visible in a deploy log, readable by anything with host access) that a properly access-controlled DB table isn't.

This is a **different** category of secret from what the rest of this architecture is built around. `NFR-SEC-02`'s client-side encryption exists so our servers structurally _cannot_ read student data, ever, not even to help. Integration credentials are the opposite: the server _must_ be able to read them in plaintext to do its job (an email can't send, a webhook can't verify, an AI draft can't generate, without the server holding a usable key in memory at call time). This ADR is about how a secret the server genuinely needs to use is stored and managed — not a weakening of the zero-knowledge posture elsewhere, a completely separate concern that happens to also involve the word "encryption."

## Decision

A new table, `integration_credentials` (`ARCHITECTURE.md` §6):

```sql
integration_credentials (
  id uuid pk, provider text not null, -- 'resend' | 'paddle' | 'bank_alfalah' | 'ai_support' | ...
  key_name text not null, -- e.g. 'api_key', 'webhook_secret' -- a provider may need more than one
  encrypted_value bytea not null, -- AES-256-GCM, server-held key (below) -- never plaintext at rest
  updated_at timestamptz not null, updated_by uuid references users(id),
  unique (provider, key_name)
)
```

- **Encrypted at rest** with a server-held symmetric key (itself supplied via the deploy environment — this one secret, unlike the credentials it protects, is acceptable as an env var/secret-manager value, since it changes only if the whole encryption scheme is rotated, not on every-day integration changes; standard envelope-encryption pattern, not a contradiction of this ADR's own goal). Decrypted only in-memory, only at the point of use (e.g., constructing the Resend API client), never logged, never returned to any admin-panel API response in decrypted form (write-only from the UI's perspective — an admin can replace a value, never read the current one back).
- **Admin-writable without a redeploy**: `M0-010` ships the table plus the minimal server-side read/write path early (needed immediately by `M0-008`); `M5-012` builds the polished admin-panel UI over the same table (add/update/rotate, per-provider, with the change itself written to `admin_audit_log` per `FR-ADMIN-02` — a credential rotation is exactly the kind of admin action that standing requirement already covers, not a new logging surface to invent).
- **Every provider adapter reads its credential from this table**, not `process.env`, at the point it needs to make a call — resolved once per cold start or per call, implementation's choice, but never baked into a build artifact.

## Alternatives considered

- **A secrets manager (AWS Secrets Manager, Hashicorp Vault, etc.).** Rejected for the same reason this project avoids Kubernetes (`ARCHITECTURE.md` §12) and a message-broker job queue (`ADR-0011`'s consequences) — real operational value at a scale and team size this project isn't at, and one more piece of infrastructure a solo founder would have to run or pay for. A well-encrypted Postgres table the app already depends on is sufficient here.
- **Plaintext in Postgres, relying on DB access control alone.** Rejected — the threat model (`ARCHITECTURE.md` §13) already treats "server compromise / DB dump" as a real row, and integration credentials (unlike wrapped student-data keys, which are useless ciphertext to an attacker) would be immediately usable secrets if stored in the clear. Encrypting them keeps a DB dump alone insufficient to exfiltrate a live, usable API key.
- **Environment variables with a documented rotation runbook.** The status quo this ADR replaces. Rejected per the founder's explicit instruction — a redeploy-to-rotate workflow is exactly the friction being removed.

## Consequences

- One more small piece of server-side crypto (the envelope-encryption key management for this table) to get right and review — proportionate to what it protects (live third-party API keys), not over-built.
- `M0-008` (email) and `M4-003`/`M4-004` (Paddle/Bank Alfalah, if not already using their own secrets by the time this lands) route their credential reads through this table going forward; any adapter still reading `process.env` directly for a rotatable secret after `M0-010` ships is a gap against this ADR, not an accepted exception.
- The admin UI (`M5-012`) never displays a stored credential's current value in plaintext once saved — only lets an admin overwrite it — the same "write path exists, read-back-in-cleartext path deliberately doesn't" shape `ADR-0005`'s wrapped-key handling already uses for a different kind of secret.

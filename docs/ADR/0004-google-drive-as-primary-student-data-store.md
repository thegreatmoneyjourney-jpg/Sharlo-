# ADR-0004: Teacher's own Google Drive (`drive.file` scope) as the primary store for student/exam data

**Status:** Accepted

## Context

The single hardest privacy/cost constraint in this product is: our servers must never be able to read student data, and we don't want to carry the storage cost or liability of holding it ourselves at all.

## Decision

All student/exam content (results, rosters, answer keys) is client-side AES-256 encrypted and written directly from the browser to the teacher's own Google Drive, using the `drive.file` OAuth scope exclusively — never broader Drive access. "Sign in with Google" and Drive consent happen in a single OAuth step. A local-only mode (browser storage, no Google account) is offered as an alternative for schools where Drive access is blocked by IT policy.

## Alternatives considered

- **Store encrypted blobs in our own object storage (e.g., S3-compatible bucket) instead of the teacher's Drive.** Rejected as the primary store: we'd be carrying storage cost and volume that scales with every teacher's entire scan history, and we'd become a much bigger target (a breach of our storage, even of ciphertext, is a worse headline than a breach of ciphertext scattered across individual teachers' own Drives). Google Drive storage is free to the teacher (within their existing quota) and the isolation is automatic — each teacher's data physically lives in a separate Google-operated account boundary, not just a logically-separated row in our database.
- **Broader Drive scope (`drive` or `drive.readonly` + a dedicated app folder under full access).** Rejected — `drive.file` is the minimum necessary scope (only files our app itself creates), which is both the right security posture and the easier path through Google's OAuth app verification process (a launch-blocking task tracked in `docs/TASKS.md` M3).
- **Require Google account with no alternative.** Rejected — schools that block Drive via IT policy would be locked out entirely; local-only mode (kickoff prompt §4.6) covers this, at the cost of that teacher's own device-loss risk, which is explicitly surfaced in the UI (SRS FR-AUTH-06).

## Consequences

- Multi-tenant data isolation for the highest-sensitivity data is largely free — it's enforced by Google's own account boundaries, not just our application logic (though Postgres RLS, ADR-0008, still protects everything that _does_ live in our database).
- We depend on Drive API availability and quota behavior as a hard dependency for the Drive-mode path; local-only mode is a genuine fallback, not just a checkbox feature, and should be kept fully functional rather than a second-class path.
- Data portability is a natural byproduct: a teacher's data is files in their own Drive (or an export they hold themselves), not something they need to request an export from us to get.
- This forecloses building any future feature that requires our backend to bulk-analyze student data across teachers (e.g., cross-school benchmarking) without a deliberate, explicit re-architecture and almost certainly re-consent — worth knowing now so it isn't assumed to be an easy add later.

# ADR-0008: Postgres Row-Level Security as a hard backstop for multi-tenant isolation

**Status:** Accepted

## Context

The kickoff prompt calls multi-tenant data isolation "the single most common and most dangerous bug class in multi-tenant SaaS" and requires it applied everywhere without exception. Sharlo's design already removes most of the highest-sensitivity data from Postgres entirely (ADR-0004), but what remains — accounts, subscriptions, usage counters, templates, school membership — still needs airtight tenant isolation.

## Decision

Every tenant-scoped Postgres table has Row-Level Security enabled, with a policy restricting rows to the current request's `user_id` (or `school_id`, for school-scoped tables), set via a session variable (`app.current_user_id`) that the API layer sets immediately after authenticating each request. The application's database role has no `BYPASSRLS` privilege, so this applies even if an application-layer query forgets a `WHERE` clause.

## Alternatives considered

- **Application-layer scoping only (every query manually filtered by tenant).** Rejected as the *sole* mechanism — this is exactly the pattern that produces the bug class the kickoff prompt calls out: one missed `WHERE user_id = ?` in one handler is a cross-tenant leak, and that kind of mistake is easy to make and easy to miss in review. Still used as the first line of defense (queries should still be written tenant-scoped), but not trusted alone.
- **Separate database/schema per tenant.** Rejected as overkill at this scale — massive operational complexity (migrations across thousands of schemas/databases) for a problem RLS solves more simply, and most of the truly sensitive data isn't in Postgres in the first place (ADR-0004).

## Consequences

- Every new table added to the schema must have an explicit RLS policy before it ships — this should be a checklist item in the Definition of Done for any task that adds a table (`docs/SRS.md` §7), not something assumed to be handled by convention.
- A missing or misconfigured RLS policy fails *closed* (no rows visible) rather than open, which is the right failure direction for this kind of bug, and also makes it very obvious in testing when a policy is missing (the feature just won't work) rather than silently leaking.
- Slightly more setup/migration complexity per table than a purely application-scoped approach — accepted given the stated priority on this specific risk.

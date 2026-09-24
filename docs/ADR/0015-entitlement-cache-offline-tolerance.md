# ADR-0015: Entitlement caching with a bounded freshness window, offline-tolerant

**Status:** Accepted — founder-directed addition to `NFR-SEC-12` (`docs/reports/SHARLO-M0-009.md` follow-up round). Specifies the actual mechanism `NFR-SEC-12` and `FR-BILLING-08` describe only in principle.

## Context

`NFR-SEC-12` establishes that Addendum 2's client-only gated features (attendance, exam config, analytics) don't have a server endpoint to reject a call against, so entitlement enforcement instead means the _entitlement itself_ — which plan the account is on — is always server-sourced, never a value the client invents or persists independently of the server. Taken literally as "always fetched fresh," this would mean a live server round-trip before the client can decide whether to show/allow any gated feature, which directly conflicts with two other standing requirements: offline-tolerant scanning (`BACKLOG-001`, approved concept) and the general principle that this app should keep working with unreliable classroom connectivity. The founder resolved this explicitly: cache locally with a bounded freshness window, re-validate on reconnect — not a live check every time, and not indefinite trust in stale data either.

## Decision

- On successful authentication and periodically thereafter, the client fetches `GET /entitlements` (`M4-005`) and stores the result **plus a timestamp** in local storage (IndexedDB, same mechanism already used for local-only mode).
- **`app_config.entitlement_cache_max_age_hours`** (admin-configurable, default **24**) is the freshness window. Founder's guidance was "24–48 hours" — defaulting to the tighter end since it's easy to raise later and harder to justify shortening after the looser default is already relied on.
- **Cache younger than the freshness window:** used immediately, no network call. This is the common case and what makes gated-feature UI feel instant rather than network-dependent.
- **Cache older than the freshness window, device online:** the stale cached value is still used immediately (never blocks the UI on a round-trip), and a background re-fetch is kicked off to refresh it. This is a deliberate "fail open on staleness" choice — a lapsed subscription might show Pro features for up to one extra freshness window plus reconnection time, which is an accepted, bounded risk, the same category as `NFR-SEC-07`'s accepted quota-tampering risk, not a new one.
- **Cache older than the freshness window, device offline:** same as above — use the stale cache, keep working, don't force a downgrade to Free-tier behavior just because the device can't currently reach the server. Re-fetch immediately on the next detected reconnection (a `navigator.onLine` / reconnect-event listener, not a poll). This is the specific behavior the founder asked for — offline scanning must keep working, and entitlement checks can't be the thing that breaks it.
- **No cache has ever been successfully populated** (first launch, or offline before any successful fetch): falls back to **Free-tier-safe defaults**, not Pro. This is the one case where the direction of the accepted risk flips — with zero server-confirmed data, "assume the safer/more restrictive default" is the right failure direction (matches `ADR-0008`'s general "fails closed" principle), whereas "trust a stale-but-once-valid cache" (the cases above) is a different, weaker risk because it _was_ server-confirmed at some point within a bounded window.

## Alternatives considered

- **Always fetch live, no cache** (the literal reading of `NFR-SEC-12`'s original wording before this addition). Rejected by the founder specifically — breaks offline tolerance and adds a network dependency to every gated-feature check, which is exactly the kind of per-action server coupling `ADR-0001`'s client-side architecture exists to avoid.
- **Cache indefinitely, no freshness window, re-validate only on explicit user action (e.g., opening the billing page).** Rejected — a downgrade or cancellation could then go unreflected for an unbounded time, which is a materially different (and worse) risk profile than a 24–48 hour bounded window; the founder's instruction was specific about wanting a freshness window, not indefinite trust.
- **A rolling/sliding freshness window that extends itself on every successful background check.** More complex for no real benefit here — a fixed window from last-successful-fetch is simpler to reason about and test, and 24 hours is already short enough that the difference is immaterial in practice.
- **Different fallback direction on zero-cache** (assume Pro rather than Free when nothing is known yet). Rejected — assuming the paid tier by default on missing data is backwards from every fail-closed pattern elsewhere in this architecture (`ADR-0008`, `NFR-ACC-03`'s "flag, don't guess") and would mean a brand-new offline device could use paid features it was never confirmed to have.

## Consequences

- `M4-005` (entitlement/plan-check layer) now explicitly includes this caching behavior, not just the server-side endpoint — implemented together, tested together, not bolted on afterward.
- Test coverage needs all four cases above as distinct scenarios (fresh cache / stale-but-online / stale-and-offline / never-populated), not just "the endpoint returns the right plan" — the caching _behavior_ is the actual feature `NFR-SEC-12` and this ADR describe.
- `app_config` (`ARCHITECTURE.md` §6) gains one more admin-tunable row alongside the STRAI TTL, consistent with that table's purpose.
- When `BACKLOG-001` (offline-first scanning) eventually gets pulled off the backlog into a milestone, its entitlement-check behavior is already designed — this ADR is written now specifically so that future work doesn't have to re-derive it.

# ADR-0010: School-plan dual-encryption for principal/admin dashboards

**Status:** Proposed — a genuinely new mechanism not specified in the source spec; needs founder confirmation before M3/M4 School-plan work starts. Does not block M1/M2. See `docs/reports/SHARLO-M0-001.md`.

## Context

The kickoff prompt requires two things that are in direct tension:

1. School plan includes "a principal/admin dashboard with school-wide results" (kickoff §1 workflow item 7, §3 School plan).
2. "Our backend must be architecturally incapable of reading student data... even we (admins) cannot read it" (kickoff §4.4), and the primary data store is *the individual teacher's own* Google Drive, encrypted to that teacher's own master key (kickoff §4.1–§4.2).

If each teacher's results are encrypted only to that teacher's own key, sitting only in that teacher's own Drive, a principal has no cryptographic or storage-location path to see them at all — not "restricted by our backend," but literally impossible without a new mechanism. The source spec doesn't address this gap, so it can't be resolved by re-reading it more carefully — it needs an actual design decision.

## Decision (proposed)

Introduce a **school-level key** at school-account creation, alongside each teacher's individual master key:

- The school gets its own randomly generated key, wrapped by the school admin's Encryption Passphrase/Recovery Key (same mechanism as ADR-0005), stored server-side as ciphertext (`schools.school_wrapped_key_by_admin_passphrase`).
- When a teacher joins a school (`school_members`), their client receives a copy of the school key material, wrapped *to that teacher* (`school_members.school_pubkey_copy`) — so the teacher's own credentials can unwrap it, but our backend never can.
- When a teacher-under-school finalizes exam results, the client encrypts the record **twice**: once to the teacher's own master key (as normal, so the teacher's individual view keeps working exactly like a non-school teacher), and once to the school key, written either as a second Drive file the school key can decrypt, or into a school-owned storage location the admin controls (open sub-question below).
- The principal dashboard reads and decrypts the school-key copies client-side, in the principal's own browser, to compute school-wide aggregates — our backend still never decrypts anything; it just serves the same kind of ciphertext blobs as before, to a different key-holder.

**Open sub-question, also needs a founder call:** where do the school-key-encrypted copies physically live? Two reasonable options:
- (a) Still in each individual teacher's Drive, with the school admin's client fetching from every teacher's Drive individually (would require *each teacher* to grant Drive access shareable with/discoverable by the school flow, which has its own consent/UX design implications) — more consistent with "teacher's own Drive is primary," more complex sync/discovery.
- (b) A Drive location the school admin owns (e.g., a Shared Drive, or the admin's own Drive under the same `drive.file` pattern), which every teacher's client writes the school-encrypted copy into — simpler discovery/read path for the principal dashboard, but means school data now also depends on the admin's own Drive/account standing, and needs its own access-grant story (each teacher's browser needs write access to the admin's Drive location, which Google Drive supports via sharing, but is a real permissioning flow to design, not a detail).

This ADR proposes the key-management mechanism (dual-encryption) as the resolution to the core cryptographic impossibility; the storage-location sub-question is left open pending founder input since it has real UX and cross-account-sharing tradeoffs either way.

## Alternatives considered

- **Principal gets a copy of the individual teacher's master key.** Rejected — this would mean the *teacher's* individual data (including exams/classes outside anything school-related, if the product ever allows a teacher to have both personal and school contexts) is no longer private from the school admin, which is a much bigger privacy surface than "school admin can see school-wide aggregated results," and not what a teacher would reasonably expect.
- **School results computed and aggregated by each teacher's client, then only an aggregate/summary (not raw per-student data) is shared to the principal, encrypted to a school key.** A real alternative worth the founder's consideration — smaller data-exposure surface (principal never even has the technical ability to see raw per-student answers, only whatever summary shape the app defines), at the cost of the principal dashboard being limited to whatever aggregates were designed in advance rather than flexible ad hoc drill-down. Noted here as a narrower-scope option if the founder prefers minimizing what the school admin can technically access, even below "full school-wide results" as literally stated in the kickoff prompt.
- **Drop the principal dashboard's access to raw results, aggregates-only, computed and periodically pushed by each teacher's client as a small encrypted summary blob.** Similar to the above; effectively a product-scope narrowing of "school-wide results" that would need explicit founder sign-off since the kickoff prompt describes it plainly as in-scope.

## Consequences

- Real added complexity in the client crypto/sync code (dual-encrypt on every finalize, not just single-encrypt) and in the Drive/storage access-grant flow for whichever storage sub-option is chosen.
- This is new design surface the kickoff prompt didn't specify, so it carries more implementation risk than the rest of the architecture, which mostly translates the spec directly. Recommend treating the first School-plan implementation as its own spike/prototype task in `docs/TASKS.md` M3, explicitly, rather than assuming the design above is final without a review pass once it's built.
- Until this is confirmed, School-plan-specific tasks in `docs/TASKS.md` M3 are marked blocked on this ADR; Free/Pro individual-teacher functionality (M1–M2 and most of M3) has no dependency on it.

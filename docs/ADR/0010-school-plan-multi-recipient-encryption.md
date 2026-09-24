# ADR-0010: School-plan dual-encryption, with school-admin-owned Drive storage for continuity

**Status:** Accepted — confirmed by founder, including the storage-location sub-question (see `docs/reports/SHARLO-M0-007.md`). The dual-encryption mechanism and the school-admin-owned storage design below are both final. One technical caveat below (Shared Drives require Google Workspace) is flagged as a known limitation with a documented mitigation, not fully closed — see "Known limitation" at the end.

## Context

The kickoff prompt requires two things in direct tension:

1. School plan includes "a principal/admin dashboard with school-wide results" (kickoff §1 workflow item 7, §3 School plan).
2. "Our backend must be architecturally incapable of reading student data... even we (admins) cannot read it" (kickoff §4.4), with the primary data store being _the individual teacher's own_ Google Drive, encrypted to that teacher's own master key (kickoff §4.1–§4.2).

If each teacher's results are encrypted only to that teacher's own key, sitting only in that teacher's own Drive, a principal has no cryptographic or storage-location path to see them — not "restricted by our backend," but actually impossible with the mechanism as specified. The source spec doesn't address this gap.

**Founder's decision on the storage-location sub-question, and the reasoning behind it:** school-key-encrypted copies must live in a Drive location the _school admin_ owns, not scattered across individual teachers' personal Drives — because school trust depends on institutional continuity: if a teacher leaves the school or their account is deactivated, the school's historical results must remain fully accessible to the admin regardless. Tying continuity to any individual teacher's personal Drive account is a trust and reliability risk for the institution, not just a technical inconvenience.

## Decision

### Dual-encryption mechanism

- Each School account gets its own randomly generated **school key** at creation, wrapped by the school admin's Encryption Passphrase/Recovery Key (same mechanism as ADR-0005), stored server-side as ciphertext (`schools.school_wrapped_key_by_admin_passphrase`).
- When a teacher joins a school, their client receives a copy of the school key material, wrapped _to that teacher_ (`school_members.school_pubkey_copy`), so the teacher's own credentials can unwrap it — our backend never can.
- When a teacher-under-school finalizes exam results, the client encrypts the record **twice**: once to the teacher's own master key exactly as normal (so their individual view is unaffected), and once to the school key, written into the school-admin-owned Drive location described below.
- The principal dashboard reads and decrypts the school-key copies client-side, in the admin's own browser. Our backend still never decrypts anything — it just serves ciphertext to a different keyholder.

### Storage location: a Drive resource the school admin owns

At School account creation, the app creates a dedicated Drive container **owned by the school admin's Google account**, and every teacher's client writes their school-key-encrypted copies into it — not into any teacher's own Drive.

**Preferred implementation — Google Shared Drive (Workspace accounts):** if the admin's Google account supports Shared Drives (i.e., a Google Workspace account, including the free Workspace for Education Fundamentals tier — common among schools that already use Google Classroom), the app creates a Shared Drive for the school. This is the technically correct answer to the founder's continuity requirement: **files created inside a Shared Drive are owned by the Shared Drive itself, not by the individual member who created them.** A teacher's departure, account deactivation, or permission revocation has zero effect on data that's already there — this is Google's own mechanism for exactly the institutional-continuity problem being solved here, not something we have to approximate.

**Fallback implementation — a regular Drive folder (personal/consumer Google accounts):** Shared Drives are not available to admins on a personal `@gmail.com`-style account (a real, common case — many schools in Sharlo's target markets, especially smaller or budget private schools, don't have a formal Workspace deployment). In this case, the app creates a regular folder owned by the admin and shares it with each teacher at Editor access. This is a materially weaker continuity guarantee: **a file a teacher creates inside a folder they only have Editor access to is owned by that teacher by default**, not by the folder or its owner. Mitigations, applied together:

1. On teacher removal, before revoking their share, the admin's authenticated client attempts a Drive API ownership transfer of any files still owned by the departing teacher onto the admin's own account.
2. The product actively recommends School-plan admins set up a free Google Workspace for Education account during School onboarding specifically to get the Shared Drive path — this is a real, concrete piece of onboarding guidance, not a vague suggestion, and should be built as such (M3-014).
3. Product copy about school-data continuity is precise about which guarantee applies: "guaranteed regardless of staff changes" language is only used for the Shared Drive path; the fallback path's messaging is honest about the weaker guarantee. This is the same principle as NFR-ACC-03's "don't overclaim" applied to a different feature.

### Access-grant flow (why this needs the Google Picker, not just Drive sharing)

`drive.file` scope (ADR-0004) only grants an app access to files it created itself, **unless** the user explicitly selects a file/folder through the Google Picker UI, which grants that specific file/folder to the app even though it didn't create it — this is Google's documented mechanism for exactly this situation, and it's a hard technical requirement, not an optional UX nicety.

Flow:

1. Admin creates the school's Drive container (Shared Drive or folder) through the app; this happens in the admin's authenticated browser session, browser-direct to Google, same as every other Drive operation in this system (ADR-0004) — our backend is told only the resulting resource's ID and type (`shared_drive` | `folder`), which is non-sensitive metadata comparable to a template record, not exam content (see `docs/ARCHITECTURE.md` §6).
2. When a teacher is added to the school, the admin's client shares the container with the teacher's Google account (Drive permissions API call, browser-direct).
3. The teacher's client, on first school-related sync, prompts them to open the Google Picker and select the shared container — a one-time step that actually grants their `drive.file`-scoped session write access to it. This must be surfaced as a clear, explained onboarding step ("Select the school folder shared with you by [Admin]") — without it, the teacher's dual-encryption write in step 4 simply fails, so it can't be skipped or assumed automatic.
4. From then on, the teacher's browser writes school-key-encrypted result copies directly into the container on every exam finalize.

### Teacher removal

Admin's client revokes the departing teacher's Drive permission on the container. For the fallback (folder) path, this is preceded by the best-effort ownership-transfer step described above.

## Alternatives considered

- **Principal gets a copy of the individual teacher's master key.** Rejected — this would expose everything encrypted under that key, not just school-relevant results, which is a much bigger privacy surface than "school admin can see school-wide results" and not what a teacher would reasonably expect.
- **Aggregates-only (principal never receives raw per-student results, only pre-computed summaries encrypted to the school key).** A real, smaller-exposure alternative that was presented to the founder alongside the full-dual-encryption option. Founder's direction was to proceed with full dual-encryption (matching the kickoff prompt's literal "school-wide results," which reads as more than aggregate-only), storage-optimized for admin ownership as above. Noted here in case a narrower-exposure version is wanted for a specific school later — it composes fine with the same storage design, just with a smaller payload written per finalize.
- **School-key copies stored in each teacher's own Drive, admin's client reads across every teacher's Drive.** This was the original, storage-location-undecided version of this ADR. Rejected by the founder specifically for the continuity reasons in "Context" above.

## Consequences

- Real added complexity in the client crypto/sync code (dual-encrypt on every finalize, not single-encrypt) and in the Drive access-grant flow (Picker-based, not automatic) — larger implementation surface than an individual-teacher-only product would have.
- The Shared-Drive-vs-folder branch means M3's School-plan tasks (`docs/TASKS.md` M3-014 onward) must implement and test **both** paths, plus the Workspace-detection logic that decides which one a given admin gets — this is genuinely two implementations behind one feature, not one.
- **Known limitation, stated plainly rather than papered over:** the strong "your school's data survives any staff change" guarantee is only fully backed for admins on Google Workspace. For a personal-Gmail admin, the guarantee is best-effort (ownership-transfer on removal), not absolute — there's a narrow window (a teacher removed before any ownership-transfer step runs, or one that fails) where a file could theoretically remain owned by a departed teacher's account. Recommend surfacing the Workspace recommendation prominently in School onboarding (M3-014) precisely to steer schools toward the fully-guaranteed path, rather than quietly shipping a guarantee that isn't uniformly true.

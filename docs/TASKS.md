# Sharlo — Task Breakdown

**Status:** Draft v1.0 for founder review. Task IDs are referenced from commit messages and `docs/reports/<task-id>.md`. Every task lists the SRS requirement IDs it implements (see `docs/SRS.md`) so nothing here is disconnected from a requirement.

**Definition of Done (applies to every task, in addition to its own criteria):** see `docs/SRS.md` §7. In short — implements the linked FR/NFR IDs, `npm run ci` green locally, tests cover the stated acceptance criteria, no new server-side code path touches plaintext student data, CI green on the pushed branch, report written to `docs/reports/<task-id>.md`.

**Retry/escalation rule (from the kickoff prompt, restated in `CLAUDE.md`):** 3 CI-fix attempts per task; if still red, mark the task blocked with details and move to the next unblocked task. Scope ambiguity or a genuine architectural gap → stop and flag in the report, don't guess.

**Blocked-pending-decision tasks:** a few tasks below are marked `BLOCKED ON: ADR-000X` — these depend on founder sign-off per `docs/reports/SHARLO-M0-001.md` and should not be started until that's confirmed, even though the milestone around them can proceed.

---

## M0 — Repo & Planning Foundation

Not in the kickoff prompt's milestone list (M1–M7) by name, but everything in M1 depends on a working repo/CI skeleton existing first, so it's called out explicitly rather than left implicit.

| ID | Title | Description | Requirement(s) | Done when |
|---|---|---|---|---|
| M0-001 | Foundational planning docs | This deliverable: SRS, ARCHITECTURE, TASKS, ADRs, CLAUDE.md, README, report/ADR folder structure. | — (governance) | All docs listed in kickoff §9 exist; report written; pushed to feature branch. **Status: done, this session — see `docs/reports/SHARLO-M0-001.md`.** |
| M0-002 | Next.js app scaffold | Initialize Next.js (App Router) + TypeScript strict mode, base folder structure per `ARCHITECTURE.md` §3, linting (ESLint) + formatting (Prettier) config. | Enables all FR work | `npm run dev` serves a placeholder home page; `npm run ci` runs lint+typecheck+test (even with zero tests) and passes. |
| M0-003 | CI pipeline | GitHub Actions workflow running `npm run ci` on every push/PR; branch protection notes documented for `main`. | Kickoff §10 | A PR against `main` shows a required, passing CI check; documented in README "how to run the CI check locally." |
| M0-004 | Dependency pinning & SCA | Lockfile committed; Dependabot/Renovate (or equivalent) wired to flag vulnerable dependencies. | NFR-SEC-10 | A deliberately outdated/vulnerable test dependency triggers an alert in CI or a bot PR. |
| M0-005 | VPS base infrastructure | Provision Hetzner VPS, Docker Compose skeleton (Postgres + Caddy + placeholder API container), domain/subdomain DNS layout (`app.`, `admin.`, apex marketing). | ARCHITECTURE.md §12 | `docker compose up` on the VPS serves a placeholder page over HTTPS on the intended domains. |
| M0-006 | Drizzle schema skeleton + RLS pattern proof | Stand up the `users` table (minimal fields) with an RLS policy, and a test proving cross-tenant reads fail. | NFR-SEC-01, ADR-0008 | A test authenticated as tenant A cannot read a row seeded for tenant B, at the DB level (not just app-layer). |

## M1 — Scanning Engine Core

| ID | Title | Description | Requirement(s) | Done when |
|---|---|---|---|---|
| M1-001 | OpenCV.js (WASM) integration & lazy-load strategy | Bundle OpenCV.js, load it lazily behind a visible loading state, keep it out of marketing-page bundles. | NFR-PERF-02 | Marketing-page Lighthouse score unaffected by the scanning bundle; scan page shows a loading indicator until WASM is ready. |
| M1-002 | Camera capture pipeline | MediaDevices API wrapper: permission handling, live preview, device-orientation handling, iOS/Android quirk handling. | FR-SCAN-01 | Verified manually on iOS Safari and Android Chrome; permission-denied state has a clear recovery path. |
| M1-003 | Corner marker detection algorithm | Detect the 4 fiducial markers for a given template against a live frame. | FR-DETECT-01, NFR-ACC-01 | ≥10fps sustained on reference device (NFR-PERF-03); detection success rate measured against a sample-sheet test set. |
| M1-004 | Stability gate & auto-capture trigger | 500ms stability window before capture; configurable constant. | FR-SCAN-02 | False-trigger rate (captures a blurred/moving frame) measured and logged as a baseline metric. |
| M1-005 | Perspective transform (dewarp) | Warp captured frame to a normalized rectangle using the 4 detected corners. | FR-DETECT-01 | Unit-testable against fixture images at various tilt angles up to 15°. |
| M1-006 | Bubble grid sampling & fill-confidence scoring | Sample each bubble region; classify confident-filled / confident-empty / ambiguous. | FR-DETECT-02, FR-DETECT-03, NFR-ACC-02, NFR-ACC-03 | Test suite of deliberately ambiguous sample sheets always routes to "flagged," never a guessed answer — this test is the enforcement mechanism for the core trust guarantee, not just documentation of it. |
| M1-007 | Capture feedback (beep/vibration) + reset loop | Audible + haptic confirmation, camera resets for next sheet. | FR-SCAN-03 | End-to-end capture-to-ready ≤2s on reference device (NFR-PERF-01), measured, not estimated. |
| M1-008 | Manual "Take Photo" fallback | Always-available manual capture button. | FR-SCAN-04 | Specifically tested on iOS Safari, where auto-capture reliability is expected to be weakest. |
| M1-009 | Roll-number grid reading | Same bubble-reading technique applied to the roll-number block. | FR-DETECT-04 | Unmatched/unread roll numbers route to Review Queue, never silently dropped. |
| M1-010 | Offline scanning capability | Full scan flow (capture → score → local queue) works with no network connection. | FR-SCAN-06, NFR-REL-01 — **recommended addition, confirm per report** | Manual QA: airplane mode for a full class scan session, zero data loss, successful sync on reconnect. |
| M1-011 | Detection engine unit test harness | Reusable fixture-based test harness (sample sheet images with known ground truth) for M1-003 through M1-009. | NFR-ACC-01–04 | Test harness runs in CI headlessly (no real camera needed) against a checked-in fixture set. |

## M2 — Templates & Review Queue

| ID | Title | Description | Requirement(s) | Done when |
|---|---|---|---|---|
| M2-001 | Sharlo stock template library | Define geometry + printable PDF for at least 20/50/100-question layouts. | FR-TPL-01 | Each stock template's geometry documented and checked into `templates` seed data; PDFs print and scan correctly end-to-end. |
| M2-002 | Template schema & versioning | `templates` table + geometry JSON schema, `schema_version` field. | ARCHITECTURE.md §6, §14 | A deliberately old-shaped template record migrates cleanly in a test. |
| M2-003 | Custom template creation from photo | Auto-detect grid from an uploaded blank/sample sheet photo; present for manual review/adjustment (drag corners, add/remove rows/cols) before save. | FR-TPL-02 | Product copy nowhere claims unattended 100% accuracy for custom templates (explicit copy review, not just a feature check). |
| M2-004 | Answer-key scan flow | Dedicated first-scan flow that sets the scoring reference for an exam. | FR-EXAM-03 | Every subsequent student-sheet scan scores immediately against the captured key. |
| M2-005 | Continuous student-sheet scan loop UX | The "show sheet → scored → ready for next, zero clicks" loop end to end. | Kickoff §1 core promise | Manual QA: scan a full class of 30+ sheets back-to-back without touching anything but holding sheets up. |
| M2-006 | Review Needed queue UI | Per-exam queue, cropped question image per flagged item, resolve UI (pick answer / left blank / exclude). | FR-REVIEW-01, FR-REVIEW-02 | Exam "fully graded" state requires an empty queue; resolving an item updates the result record. |
| M2-007 | Review image retention/purge | Cropped/full images used for review purged on a short timer / session end, not retained by default. | FR-REVIEW-03, NFR-SEC-05 | Automated test confirms review images are gone from storage (memory/IndexedDB) after the retention window. |
| M2-008 | Duplicate-sheet detection | Client-side check against the synced results index for the exam; teacher can override with "rescan intentionally." | FR-DETECT-05 | Rescanning the same roll number for the same exam triggers a warning before it's saved. |
| M2-009 | Batch import (scanner images/PDFs) | Multi-image and PDF-page-split import reusing the M1 detection pipeline per page/image. | FR-SCAN-05 | A batch of 20 scanner-produced images processes through the same review-queue/scoring path as live scans. |

## M3 — Accounts, Auth & Drive Sync

`BLOCKED ON: ADR-0005` for anything touching master-key wrapping. `BLOCKED ON: ADR-0010` for School-plan-specific tasks only (marked below) — individual teacher tasks are not blocked.

| ID | Title | Description | Requirement(s) | Done when |
|---|---|---|---|---|
| M3-001 | Google OAuth redirect flow | PKCE redirect-based sign-in (not popup), requesting `openid email profile drive.file` only. | FR-AUTH-01, FR-AUTH-02, NFR-SEC-03 | Works on iOS Safari without popup-blocked failures; scope list matches exactly, enforced by the CI check in M3-011. |
| M3-002 | Session management | httpOnly signed session cookie, Postgres-backed session store, CSRF protection. | ARCHITECTURE.md §9 | Session survives refresh; CSRF test confirms a cross-site POST is rejected. |
| M3-003 | Master key generation & wrapping — `BLOCKED ON: ADR-0005` | Generate random master key at signup; Encryption Passphrase + Argon2id wrap; Recovery Key generation and second wrap. | FR-AUTH-03, FR-AUTH-04, FR-AUTH-05, FR-AUTH-07 | Test: sign up, change passphrase, confirm all prior encrypted data still decrypts without being touched. |
| M3-004 | Recovery Key onboarding UX | Forced "I've saved my Recovery Key" confirmation; download/print option; unmissable "lose both = unrecoverable" messaging. | FR-AUTH-05, FR-AUTH-08 | Signup cannot complete without the explicit confirmation step. |
| M3-005 | Local-only mode | IndexedDB storage path, persistent data-loss-risk warning, Export/Import backup file. | FR-AUTH-06 | A local-only account can fully use the product with zero network calls to Drive; export/import round-trips correctly. |
| M3-006 | Drive file CRUD (browser-direct) | Create/read/update the encrypted JSON envelope (`ARCHITECTURE.md` §7) directly from the browser to the teacher's Drive using `appProperties` tagging, with zero backend involvement in the request path. | ADR-0004 | Network inspection during a save confirms the request goes browser→Google directly, never through our API. |
| M3-007 | Class list CSV upload & roll-number matching | Parse CSV client-side, store encrypted, match scanned roll numbers to roster entries. | FR-ROSTER-01, FR-ROSTER-02 | Unmatched roll numbers route to Review Queue (ties to M1-009). |
| M3-008 | Results table UI | Editable spreadsheet-like view: name/roll fix-up, per-question breakdown. | FR-RESULTS-01, FR-RESULTS-02 | Inline edit of a misread name/roll number persists correctly (re-encrypted, re-saved). |
| M3-009 | Class analytics | Hardest questions, weakest students, score distribution — computed client-side. | FR-RESULTS-03 | Verified against a known fixture dataset with hand-calculated expected stats. |
| M3-010 | Export: Excel/CSV + printable result cards | Export functionality with CSV/formula-injection sanitization. | FR-RESULTS-04, FR-RESULTS-05, NFR-SEC-06 | A roster entry crafted as `=1+1` (or similar) exports as a literal string, not a formula, when opened in Excel. |
| M3-011 | OAuth scope CI guard | Automated check that fails CI if the requested OAuth scope list changes without an explicit, reviewed diff. | NFR-SEC-03 | A test PR that adds a broader Drive scope fails CI with a clear message. |
| M3-012 | Google OAuth app verification submission | Privacy policy, domain ownership, branding, scope justification, demo video prepared and submitted. | ARCHITECTURE.md §13 threat model | Verification submitted with enough lead time before launch (Google's review can take days–weeks) — treat as launch-blocking and start early, not at the end of M3. |
| M3-013 | Data versioning/migration framework | `schemaVersion` handling for encrypted envelopes; a real migration exercised end-to-end. | ARCHITECTURE.md §14 | A v1-shaped fixture record migrates to a deliberately-introduced v2 shape in a test. |
| M3-014 | School account & school-key setup — `BLOCKED ON: ADR-0010` | School entity creation, school-level key generation/wrapping, teacher-join flow granting wrapped key copies. | ADR-0010 | Do not start until the founder has confirmed the dual-encryption design and the storage-location sub-question in ADR-0010. |
| M3-015 | Dual-encryption on result finalize — `BLOCKED ON: ADR-0010` | Teacher-under-school clients encrypt results to both their own key and the school key. | ADR-0010 | Same as above. |
| M3-016 | Principal/school dashboard — `BLOCKED ON: ADR-0010` | School-wide results view, decrypting school-key copies client-side in the admin's browser. | Kickoff §1 workflow item 7, §3 School plan | Same as above. |

## M4 — Billing (Paddle, Bank Alfalah)

| ID | Title | Description | Requirement(s) | Done when |
|---|---|---|---|---|
| M4-001 | Pricing/tier data model | `pricing_tiers`, `country_tier_map` tables, seeded with the kickoff prompt's initial values. | FR-BILLING-01, FR-BILLING-02, ARCHITECTURE.md §6 | Admin can change a price and see it reflected on the pricing page without a deploy. |
| M4-002 | `PaymentProviderAdapter` interface | The shared interface both providers implement (`ARCHITECTURE.md` §10). | ADR-0006 | Interface has a passing contract test both adapters must satisfy. |
| M4-003 | Paddle adapter | Checkout, webhook ingestion + signature verification, subscription lifecycle, country/currency from Paddle's reported billing country. | FR-BILLING-03, FR-BILLING-04, NFR-SEC-11 | A test purchase (Paddle sandbox) flows through to an `active` subscription and correct plan entitlement. |
| M4-004 | Bank Alfalah adapter | PKR checkout/callback, signature/integrity verification, reconciliation into the same subscription shape. | FR-BILLING-04, NFR-SEC-11 | A test PKR purchase (sandbox/UAT if available) flows through to an `active` subscription. |
| M4-005 | Entitlement/plan-check layer | Single provider-agnostic function the rest of the app calls to check plan/limits. | FR-BILLING-01 | Plan-gated features (unlimited templates, no ads, etc.) work identically regardless of which provider the subscription is on. |
| M4-006 | Free-tier usage counters | `usage_counters` table, client-side increment-on-finalize call, optimistic offline buffering + reconciliation. | FR-BILLING-06, NFR-SEC-07 | Airplane-mode scanning session still enforces the cap correctly once back online; soft-enforcement behavior documented, not silently absent. |
| M4-007 | Plan upgrade/downgrade/cancel flows | Teacher-facing plan management UI. | FR-BILLING-01 | Downgrade from Pro to Free correctly re-applies Free-tier limits going forward without touching historical data. |
| M4-008 | School seat management | Minimum 5 seats, add/remove seats, per-teacher/year billing, proration per provider's rules. | FR-BILLING-07 | Adding a 6th seat mid-cycle bills correctly per the provider's proration behavior. |
| M4-009 | Provider-adapter extensibility proof | A stub/mock third adapter (not Easypaisa/JazzCash for real, just a test double) proving the interface supports a new provider without touching existing code. | FR-BILLING-05 | Mock adapter passes the same contract test as M4-002 with zero changes to `PaymentProviderAdapter` or existing adapters. |

## M5 — Admin Panel

| ID | Title | Description | Requirement(s) | Done when |
|---|---|---|---|---|
| M5-001 | Admin subdomain scaffold + 2FA/passkey login | Separate deploy target, `noindex`, server-side-enforced 2FA/passkey. | FR-ADMIN-01 | Login without completing 2FA fails closed; subdomain confirmed non-indexable. |
| M5-002 | Audit log infrastructure | Append-only `admin_audit_log`, no `DELETE`/`UPDATE` grant to the app role. | FR-ADMIN-02, NFR-SEC-09 | An attempt to delete/edit an audit row via the app's DB role fails at the permission level, tested directly. |
| M5-003 | User & subscription management | View/block/refund/change-plan, refund routed through the correct provider adapter. | FR-ADMIN-03 | Refunding a Bank Alfalah subscriber calls the Bank Alfalah adapter, not Paddle, and vice versa. |
| M5-004 | Pricing/country-tier editor | Admin UI over M4-001's data model. | FR-ADMIN-04, FR-BILLING-02 | — |
| M5-005 | Feature flags | Segmentable by user/plan/cohort. | FR-ADMIN-05 | A flag scoped to "Pro plan only" correctly shows/hides for a Free-plan test account. |
| M5-006 | Ads on/off toggle | Global toggle affecting results/dashboard pages only, never the scanning screen. | FR-ADMIN-06 | Confirmed no ad slot renders on the scanning screen even when ads are globally on. |
| M5-007 | Revenue analytics dashboard | MRR, churn, revenue by country/tier; multi-currency normalization; gross vs. net-of-fees. | FR-ADMIN-07 | A PKR + a USD test transaction both roll up correctly into one normalized MRR figure. |
| M5-008 | Error/crash log viewer + scrubbing layer | Allow-list-based log scrubbing (not block-list) so new endpoints are unlogged-by-default until reviewed. | FR-ADMIN-08, NFR-SEC-05 | A deliberately triggered error containing a fake "student name" field in the request body does not appear in the log viewer. |
| M5-009 | Announcement/broadcast system | Message all/segmented users. | FR-ADMIN-09 | — |
| M5-010 | Support/ticket view | Minimal internal queue. | FR-ADMIN-10 | — |
| M5-011 | Admin "cannot decrypt" structural verification | A written, reviewable check (code-level, not just doc-level) confirming no admin code path receives key material or Drive content. | FR-ADMIN-11, ARCHITECTURE.md §11 | A grep/lint-style check or documented manual audit trail exists and is repeatable for future admin features. |

## M6 — SEO / Marketing Site

| ID | Title | Description | Requirement(s) | Done when |
|---|---|---|---|---|
| M6-001 | Marketing pages | Home, pricing, features, about — SSR with metadata/OpenGraph per page. | FR-SEO-01 | Each page's metadata validated (title, description, OG image, canonical). |
| M6-002 | Schema.org structured data | `SoftwareApplication`, `FAQPage`, etc. | FR-SEO-02 | Validates cleanly in a structured-data test tool. |
| M6-003 | `llms.txt` | AI-answer-engine-facing site description. | FR-SEO-03 | Present at site root; claims cross-checked against actual product behavior (esp. accuracy claims, per NFR-ACC honesty requirement). |
| M6-004 | Blog/CMS scaffold | Routing/content structure, zero articles required at launch. | FR-SEO-04 | Route renders a graceful empty state; content authoring can proceed independently of app deploys. |
| M6-005 | Crawlability audit | Confirm no critical content is client-render-only. | FR-SEO-05 | Marketing pages reviewed with JS disabled / view-source; core content present in initial HTML. |
| M6-006 | Sitemap/robots.txt | Standard sitemap; admin subdomain excluded/disallowed. | FR-ADMIN-01 (robots aspect) | `robots.txt` confirmed to exclude `admin.*`. |

## M7 — Launch Hardening

| ID | Title | Description | Requirement(s) | Done when |
|---|---|---|---|---|
| M7-001 | Security review against the threat model | Pass over every row in `ARCHITECTURE.md` §13, confirming each mitigation is actually implemented, not just designed. | All NFR-SEC-* | Each threat-model row has a linked test or documented manual verification. |
| M7-002 | Rate limiting & upload validation audit | Every endpoint reviewed for rate limits and input validation. | NFR-SEC-04 | Automated test hits an unprotected-looking endpoint with a burst of requests and confirms throttling. |
| M7-003 | Signed, expiring export URLs | Any export/download that transits the backend uses signed, time-limited URLs. | NFR-SEC-08 | An export URL fails after its expiry window in a test. |
| M7-004 | "Delete all my data" self-service flow | Teacher-initiated full account/data deletion. | NFR-PRIV-03 | Deletion removes the Postgres account record and revokes Drive app access; documented retention policy matches actual behavior. |
| M7-005 | Data retention/deletion policy doc | Written policy matching M7-004's actual implementation. | NFR-PRIV-03 | Legal-readable doc exists and matches code behavior (no policy promising something the code doesn't do, or vice versa). |
| M7-006 | Load/performance testing | Basic load test against the VPS sizing assumptions in `ARCHITECTURE.md` §12. | NFR-SCALE-02 | Documented results against a target concurrent-user figure the founder agrees is a reasonable launch assumption. |
| M7-007 | Admin subdomain network-layer hardening | Cloudflare Access (or equivalent) in front of admin 2FA login. | ARCHITECTURE.md §11 recommendation | **[DECISION NEEDED — non-blocking]** confirm before building; not required for the admin panel to function. |
| M7-008 | Monitoring, alerting, backup verification, incident runbook | Uptime/error monitoring, automated backup-restore drill, a short written incident runbook. | ARCHITECTURE.md §12 | A backup is actually restored to a scratch environment and verified readable, not just "backups exist." |
| M7-009 | Privacy Policy, Terms of Service, school DPA template | Legal docs reflecting the actual architecture (esp. the processor/controller framing in NFR-PRIV-01). | NFR-PRIV-01, NFR-PRIV-02 | Recommend a legal-professional review pass before publishing, not just an engineering draft — flagged as a real launch dependency outside pure engineering. |
| M7-010 | Ads integration | Ad network selection + placement limited to results/dashboard pages only. | Kickoff §3 Free plan | Confirmed via M5-006's placement test plus a real ad network wired in. |
| M7-011 | Launch checklist sign-off | Consolidated go/no-go checklist referencing every prior M7 task. | — | Founder-reviewed and explicitly approved before flipping the site public. |

---

## Milestone dependency summary

```
M0 (foundation) ─┬─▶ M1 (scanning core) ─▶ M2 (templates/review) ─┐
                  │                                                  ├─▶ M6 (SEO/marketing, mostly independent) 
                  └─▶ M3 (auth/Drive) ──▶ M4 (billing) ──▶ M5 (admin) ┘
                                                                        └─▶ M7 (launch hardening, depends on all)
```

M1/M2 have no dependency on the ADR-0005/ADR-0010 decisions and can start immediately. M3's core (individual teacher auth/Drive) is blocked only on ADR-0005; School-specific M3 tasks are additionally blocked on ADR-0010. M6 can largely proceed in parallel with M1–M5 once M0 scaffolding exists.

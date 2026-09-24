# Sharlo — Software Requirements Specification (SRS)

**Status:** Draft v1.0 for founder review — no feature code has been written against this yet.
**Source of truth:** This document is derived from the project kickoff prompt (see `docs/reports/SHARLO-M0-001.md` for the report that produced it). Where this SRS makes a judgment call the kickoff prompt didn't explicitly settle, it's marked **[DECISION NEEDED]** and also logged in that report. Nothing marked that way should be treated as final until you confirm it.

---

## 0. Document map

- **This document (SRS):** *what* the system must do, for *whom*, and how we'll know it's done.
- `docs/ARCHITECTURE.md`: *how* it's built — system design, data flows, schema, threat model.
- `docs/ADR/`: *why* specific technical decisions were made.
- `docs/TASKS.md`: the work broken into milestones and tickets, traceable back to the requirement IDs in this document.

---

## 1. Purpose & scope

Sharlo is a mobile-first, browser-based SaaS product that lets a teacher grade multiple-choice (OMR/bubble-sheet) exams by pointing a phone or laptop camera at each answer sheet, with all image analysis happening client-side. This SRS covers the full v1 launch scope as defined in the kickoff prompt: scanning/detection, templates, review queue, rostering, results/analytics, export, billing (Paddle + Bank Alfalah), the admin panel, encryption/data-storage model, and SEO/AEO/GEO scaffolding.

Anything under "Out of scope" in Section 14 is explicitly **not** part of this SRS's acceptance criteria.

---

## 2. Definitions & glossary

| Term | Meaning |
|---|---|
| OMR | Optical Mark Recognition — detecting which bubble(s) are filled on a sheet. |
| Sheet | A single physical answer sheet (answer key or student sheet). |
| Template | A layout definition describing where the corner markers, roll-number grid, and question bubbles sit on a sheet. |
| Review Needed / Review Queue | The set of individual question-answers the engine could not confidently score, requiring manual teacher resolution. |
| Tenant | A teacher account or a school account — the isolation boundary for data access. |
| Master Key | The per-teacher symmetric key used to encrypt all student data client-side. Never stored in plaintext anywhere. |
| Wrapping / wrapped key | Encrypting the master key itself with a second key, so the master key can be stored server-side as ciphertext. |
| Recovery Key | A one-time-displayed random key that can independently unwrap the master key if the teacher's normal unlock method is lost. |
| Encryption Passphrase | **[DECISION NEEDED — see §4.1]** A secret distinct from the teacher's Google login, proposed as the second way to unwrap the master key. |
| `drive.file` scope | The restrictive Google Drive OAuth scope that only grants access to files the app itself created — never the user's whole Drive. |
| MoR | Merchant of Record (Paddle) — handles global tax/VAT compliance and remittance on our behalf. |
| PPP | Purchasing Power Parity — basis for the country-tiered pricing model. |

---

## 3. User roles & permissions

| Role | Description | Key permissions |
|---|---|---|
| **Teacher** (individual, Free or Pro) | Primary user. Creates exams, scans sheets, manages own results. | Full CRUD on own exams/templates/results; manage own billing; export own data; delete own account/data. |
| **School Admin / Principal** (School plan) | Manages a school's teacher seats and views school-wide analytics. | Invite/remove teacher seats; view aggregated (not raw per-student, see §4.4 and ADR-0010) school analytics; manage school billing. Does **not** get elevated access to any individual teacher's raw encrypted data beyond what that teacher's client explicitly shares under the School plan's dual-encryption model. |
| **Teacher-under-School** | A teacher whose seat is paid for by a School account. | Same as Teacher, plus their results are also encrypted to the school's key per ADR-0010. |
| **Platform Admin** (Sharlo staff — founder at launch) | Operates the admin panel. | User/subscription management, pricing config, feature flags, revenue analytics, audit log, broadcast messages. Structurally **cannot** decrypt student data (see §4.4, §11). |

Role assignment is stored per-account in Postgres (never inferred from client claims) and every admin-panel action is authorized server-side, never by hiding a URL client-side.

---

## 4. Data classification (read this before the functional requirements)

This governs where every piece of data is allowed to live, and it's the backbone of the whole security model.

| Data | Classification | Where it lives |
|---|---|---|
| Student names, roll numbers, per-question marks, scores, class lists | **Sensitive — student PII** | Client-side AES-256-GCM encrypted before leaving the browser. Primary copy in the teacher's own Google Drive (`drive.file`); local-only mode keeps it in browser storage only. **Never** in plaintext on our servers, never in our server logs, never in our error tracker. |
| Answer keys (which option is correct per question) | **Sensitive — exam integrity** | Same as above. A leaked answer key is a real harm to a teacher even though it's not "PII" in the strict sense, so it gets the same treatment. |
| Exam titles, question counts, per-exam settings | **Sensitive by association** | Treated as encrypted content too (a title like "Grade 5 Math Midterm — Lincoln Elementary" can itself be identifying). Because of this, our backend has **no need** to know it exists, and doesn't store it — see §12 of ARCHITECTURE.md. |
| Blank template layouts (corner marker positions, bubble grid geometry) | **Non-sensitive** | Contains no student data or exam content — just geometry of a blank sheet. May live in our own object storage for sharing/reuse across a teacher's exams. |
| Account data: email, Google subject ID, plan, subscription state, wrapped master-key ciphertext, recovery-key verification hash, monthly usage counters | **Operational, access-controlled, not student PII** | Postgres, tenant-isolated. |
| Billing/payment events | **Operational, financial** | Postgres, plus whatever Paddle/Bank Alfalah retain on their side as the payment processors. |
| Admin audit log | **Operational, security-relevant** | Postgres, append-only. |

**Working rule for every future feature:** if a field could identify a student or reveal exam content, it is encrypted client-side before it ever reaches a network call, full stop — even if that makes a feature (like the School dashboard) harder to build. Convenience never overrides this rule; if a feature seems to require breaking it, that's a **[DECISION NEEDED]**, not a silent workaround.

---

## 5. Functional requirements

Each requirement has an ID, a description, and acceptance criteria. IDs are referenced from `docs/TASKS.md` so every task traces back to a requirement.

### 5.1 FR-AUTH — Authentication & account

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-AUTH-01 | Teacher signs in with Google via redirect-based OAuth (not popup). | Sign-in works on iOS Safari, Android Chrome, and desktop Chrome/Firefox/Safari without popup-blocked failures. Redirect flow uses PKCE. |
| FR-AUTH-02 | Sign-in also requests Drive `drive.file` scope in the same consent step (unless the teacher picks local-only mode, FR-AUTH-06). | Single consent screen; scope list shown to user never includes broader Drive access. |
| FR-AUTH-03 | On first sign-in, the app generates a random 256-bit master key client-side and sets up key wrapping. | See §4.1's resolution — master key never transmitted in plaintext; network tab shows only ciphertext for key material. |
| FR-AUTH-04 | Teacher sets an **Encryption Passphrase** distinct from their Google account, during signup. | Passphrase strength meter shown; passphrase itself never sent to the server in plaintext (only used locally to derive a wrapping key via Argon2id). |
| FR-AUTH-05 | Teacher is shown a one-time **Recovery Key** at signup and must actively confirm they've saved/downloaded/printed it before continuing. | Signup cannot complete without an explicit "I've saved my Recovery Key" confirmation step; key is downloadable as a text file and shown once, never retrievable again from our systems. |
| FR-AUTH-06 | Teacher can opt into **local-only mode** (no Google account) at signup instead. | All data stays in browser storage (IndexedDB); teacher is shown a persistent, unmissable warning about device-loss / browser-data-clearing risk; "Export backup file" / "Import backup file" are available from the first session. |
| FR-AUTH-07 | Changing the Encryption Passphrase only re-wraps the master key. | Re-wrap operation completes without touching any existing encrypted exam/result records; verified by a test that changes the passphrase and confirms all prior data still decrypts. |
| FR-AUTH-08 | Losing both the Encryption Passphrase and the Recovery Key means the data is unrecoverable — by design. | Documented plainly in the product UI (not just the privacy policy) at the point the Recovery Key is issued. |
| FR-AUTH-09 | Beyond the signup-time confirmation (FR-AUTH-05), the app proactively re-prompts a teacher to re-verify their Recovery Key is safely saved at 7 days and 30 days after issuance, via both an in-app banner and email, until they explicitly re-confirm. **Founder-required, added after initial SRS draft — see `docs/reports/SHARLO-M0-007.md`.** | A test account with `recovery_key_reminder_dismissed_at` unset receives exactly one 7-day and one 30-day reminder (both channels), and no more after an explicit re-confirmation action (re-download + confirm, not a passive dismiss). See ADR-0005 addendum, ADR-0011. |

### 5.2 FR-EXAM — Exam creation

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-EXAM-01 | Teacher creates an exam: title, number of questions, per-question option count (e.g., A–D or A–E). | Exam object created client-side, encrypted before any persistence. |
| FR-EXAM-02 | Teacher selects a template: a Sharlo pre-made layout, or a custom one generated from a photo (FR-TPL-02). | Exam is linked to exactly one template + its version. |
| FR-EXAM-03 | Teacher scans the answer key sheet first and the system stores it as the scoring reference for that exam. | Once an answer key is captured, every subsequent student sheet scan for that exam scores against it immediately (client-side). |

### 5.3 FR-TPL — Templates

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-TPL-01 | A library of ready-made Sharlo bubble-sheet templates (multiple question-count variants) with corner alignment markers, available as printable PDFs. | At minimum: 20, 50, and 100-question variants at launch, each with documented marker geometry in `docs/ARCHITECTURE.md`. |
| FR-TPL-02 | Teacher can upload a photo of a custom/existing sheet and the system auto-generates a template (detected grid + corner markers) from it. | Teacher reviews and can manually adjust the detected grid (drag corners, add/remove rows/columns) before the template is used for scoring. We do **not** claim unattended 100% accuracy for custom templates anywhere in the product copy. |
| FR-TPL-03 | Free plan is limited to Sharlo templates + 1 custom template; Pro/School are unlimited custom templates. | Enforced against the plan/entitlement record at template-creation time. |

### 5.3a FR-SCHOOL — School plan & principal dashboard

Added to close a traceability gap: the principal dashboard was described in §3 (roles) and designed in `docs/ADR/0010-school-plan-multi-recipient-encryption.md`, but hadn't been given its own requirement IDs. Backfilled here now that the design is confirmed (`docs/reports/SHARLO-M0-007.md`).

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-SCHOOL-01 | School account creation generates a school key and a school-admin-owned Drive storage container (Shared Drive where the admin's Google account supports it, a shared folder otherwise). | See ADR-0010. Onboarding actively recommends a free Google Workspace for Education account when the admin is on a personal Google account, to get the stronger (Shared Drive) continuity guarantee. |
| FR-SCHOOL-02 | Adding a teacher to a school grants them a wrapped copy of the school key and shares the school's Drive container with them; the teacher must complete a one-time Google Picker selection step before their results can dual-encrypt to the school. | Onboarding clearly explains the Picker step ("select the folder shared by your admin") — it's a required action, not assumed automatic. A teacher who skips it sees a clear, specific error/prompt on next finalize, not a silent failure. |
| FR-SCHOOL-03 | On exam finalize, a teacher-under-school's client encrypts results to both their own key (personal view, unaffected) and the school key (written to the school's Drive container). | Verified by a test: a teacher-under-school's individual results view is identical in behavior to a non-school teacher's; the school-key copy independently decrypts in the admin's session. |
| FR-SCHOOL-04 | Principal dashboard shows school-wide results, decrypted client-side in the admin's own browser from the school-key copies. | Our backend is never in the decrypt path — verified the same way as FR-ADMIN-11. |
| FR-SCHOOL-05 | Removing a teacher from a school preserves the school's already-written historical data regardless of that teacher's account status afterward. | On the Shared Drive path, verified structurally (Shared Drive files are never teacher-owned). On the fallback folder path, verified by a test that ownership-transfer runs on removal, and product copy about this guarantee is worded to match which path applies (see ADR-0010's stated limitation — don't overclaim on the fallback path). |

### 5.4 FR-SCAN — Camera scanning & capture

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-SCAN-01 | Live camera view continuously attempts to detect the 4 corner markers of the current template. | Detection loop runs client-side at an interactive frame rate (target ≥10 fps on a mid-range 2020+ smartphone). |
| FR-SCAN-02 | Once all 4 corners are detected and stable (no significant movement) for ~0.5s, the system auto-captures — no manual tap required. | Stability window is configurable (default 500ms); measured false-trigger rate (capturing a blurred/moving frame) is tracked as a quality metric during M1 testing. |
| FR-SCAN-03 | On capture: audible beep + device vibration (where supported) confirms the capture, then the camera view immediately resets for the next sheet. | End-to-end from "sheet held steady" to "ready for next sheet" ≤2 seconds on the reference device class (see NFR-PERF-01). |
| FR-SCAN-04 | A manual "Take Photo" button is always available as a fallback to auto-capture. | Required and tested specifically on iOS Safari, where camera API behavior is least consistent. |
| FR-SCAN-05 | Batch import of scanner-produced images or PDFs (multiple sheets at once) is supported as an alternative to live scanning. | PDF is split page-by-page client-side; each page/image runs through the same detection pipeline as a live capture. |
| FR-SCAN-06 | **BACKLOG — approved concept, explicitly deferred past launch, not in v1 scope.** Scanning works with no network connection; only the final sync to Drive (or local save) may require connectivity, and that sync is queued if offline. | Founder approved the idea but directed it to backlog for a later milestone rather than v1 (`docs/reports/SHARLO-M0-007.md`) — do not build against this until it's pulled off the backlog into a milestone. When it is: manual QA, enable airplane mode mid-session, scan a full class, confirm zero data loss and successful sync once reconnected. |

### 5.5 FR-DETECT — OMR detection engine

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-DETECT-01 | Given a captured frame and the active template, the engine locates the 4 corner markers and computes a perspective transform to normalize the sheet. | See NFR-ACC-01 for the numeric target. |
| FR-DETECT-02 | The engine samples each bubble region and computes a fill-confidence score. | Confidence scoring must distinguish "clearly filled," "clearly empty," and "ambiguous" (partial fill, multiple marks, erasure smudge). |
| FR-DETECT-03 | Any bubble/question that isn't confidently scoreable is **never** auto-guessed. | This is the core trust guarantee of the product — see NFR-ACC-03. Verified by a test suite of deliberately ambiguous sample sheets where the expected output is "flagged," not a best-guess answer. |
| FR-DETECT-04 | Roll-number bubbles are read the same way as answer bubbles (grid of digits, not handwriting), and matched against the uploaded class list. | If the read roll number doesn't match any roster entry, the sheet is routed to the Review Queue for manual roll-number entry — never silently discarded. |
| FR-DETECT-05 | Duplicate-sheet detection: warn if the same student sheet (same exam + same roll number, or a matching visual fingerprint) is scanned twice. | Checked client-side against the already-synced results index for that exam (see ARCHITECTURE.md §6 for how this works without server-side content access). Teacher can confirm "rescan intentionally" to override. |

### 5.6 FR-REVIEW — Review Needed queue

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-REVIEW-01 | Every flagged question appears in a per-exam Review Queue with a cropped image of just that question region. | Crop is generated client-side from the already-captured frame; nothing new is captured from the camera. |
| FR-REVIEW-02 | Teacher resolves each flagged item by picking the correct answer (or marking "left blank" / "invalid, exclude from scoring"). | Resolving an item updates the result record and removes it from the queue; the exam's "fully graded" state requires an empty queue. |
| FR-REVIEW-03 | Sheet images used for review are not retained beyond the active review session by default. | If temporarily cached (e.g., in-memory or IndexedDB during the session) to support the queue UI, they are purged on a short timer / session end — see NFR-SEC-05. |

### 5.7 FR-ROSTER — Class list & roll numbers

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-ROSTER-01 | Teacher uploads a class list (CSV: roll number, student name) once per class; reusable across exams for that class. | CSV parsed client-side; stored encrypted like any other student data. |
| FR-ROSTER-02 | Scanned roll numbers auto-match to the roster to populate the student's name in results. | Unmatched roll numbers are flagged (FR-DETECT-04), never silently left blank without teacher awareness. |

### 5.8 FR-RESULTS — Results table & analytics

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-RESULTS-01 | Results land in an editable, spreadsheet-like table: student name, roll number, per-question answer, score. | Teacher can correct a misread name/roll number inline. |
| FR-RESULTS-02 | Per-question breakdown view (e.g., % of class that got Q7 right). | Computed client-side from decrypted local data. |
| FR-RESULTS-03 | Class analytics: hardest questions, weakest students, score distribution. | Same as above — all computed client-side, nothing sent to our servers to generate these. |
| FR-RESULTS-04 | Export to Excel/CSV. | See NFR-SEC-06 for a specific, easy-to-miss export vulnerability class that must be mitigated. |
| FR-RESULTS-05 | Printable result cards (per student). | Generated client-side (e.g., print-optimized view or client-generated PDF). |

### 5.9 FR-BILLING — Plans, pricing & payment

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-BILLING-01 | Three plans — Free, Pro, School — enforced per the limits in the kickoff prompt (150 sheets/month free, ads on results/dashboard only, School = Pro features + principal dashboard + 5-seat minimum). | Plan limits read from admin-configurable config at runtime, never hardcoded. |
| FR-BILLING-02 | All prices, country-tier assignments, and monthly/yearly availability per tier are edited from the admin panel without a code deploy. | Changing a price in the admin panel reflects on the pricing page and at checkout within normal cache-invalidation time (target: immediate to <5 min). |
| FR-BILLING-03 | Country tier is determined by the billing/card country reported by Paddle at checkout — never by IP address. | Verified by test: a VPN'd IP from a different country than the card's billing country still prices correctly by card country. |
| FR-BILLING-04 | Paddle (MoR) handles all billing outside Pakistan; Bank Alfalah handles PKR billing inside Pakistan. | Both providers reconcile into one internal entitlement model (see ARCHITECTURE.md §10) so plan/feature checks never need to know which provider a given teacher is on. |
| FR-BILLING-05 | Easypaisa/JazzCash are not built at launch, but the billing/provider architecture must accept a new provider without a redesign. | Demonstrated by the provider-adapter interface in ARCHITECTURE.md having at least 2 real implementations (Paddle, Bank Alfalah) behind it already, proving a 3rd can be added. |
| FR-BILLING-06 | Free-tier usage (150 sheets/month) is tracked and enforced without any scan content ever reaching the server. | See NFR-SEC-07 for the specific enforcement-integrity tradeoff this implies, and the accepted risk. |
| FR-BILLING-07 | School plan: minimum 5 teacher seats, priced per teacher/year; principal can add/remove seats. | Seat count changes reflect in the next Paddle/Bank Alfalah billing cycle per that provider's proration rules. |

### 5.10 FR-ADMIN — Admin panel

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-ADMIN-01 | Separate subdomain, not indexable (robots noindex + disallow), 2FA/passkey-gated login. | Confirmed via a live `robots.txt`/meta-robots check and a login attempt without 2FA failing closed. |
| FR-ADMIN-02 | Every admin action is authorized server-side and written to an append-only audit log. | Audit log entries cannot be deleted or edited by the application role (enforced at the DB permission level, not just app logic). |
| FR-ADMIN-03 | User & subscription management: view, block, refund, change plan. | Refund action calls through to the correct payment provider adapter (Paddle or Bank Alfalah) based on the teacher's billing provider. |
| FR-ADMIN-04 | Pricing/country-tier editor (see FR-BILLING-02). | — |
| FR-ADMIN-05 | Feature flags, segmentable by user/plan/cohort. | — |
| FR-ADMIN-06 | Ads on/off toggle. | Toggling off removes ad slots from results/dashboard pages without a deploy. |
| FR-ADMIN-07 | Revenue analytics: MRR, churn, revenue by country/tier. | Multi-currency revenue (USD, PKR, others via Paddle) is normalized to a single reporting currency; gross vs. net (post processor-fee) revenue both shown — see the finance note in the M0 report. |
| FR-ADMIN-08 | Error/crash log viewer. | Log pipeline is scrubbed so student PII can never appear in a logged error, even accidentally (enforced by NFR-SEC-05/§11 of ARCHITECTURE.md, not just convention). |
| FR-ADMIN-09 | Announcement/broadcast system to users. | — |
| FR-ADMIN-10 | Support/ticket view (if a support tool is integrated). | Minimal for launch; can be a simple internal queue rather than a full helpdesk product. |
| FR-ADMIN-11 | Admins cannot decrypt student data through any admin-panel code path. | This must be **structurally** true — see ARCHITECTURE.md §11: the admin panel has no code path that ever receives a master key, a wrapping key, or Drive file content. |

### 5.11 FR-SEO — SEO / AEO / GEO

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-SEO-01 | Metadata + OpenGraph tags on every marketing page. | Validated per-page (title, description, OG image, canonical URL). |
| FR-SEO-02 | Schema.org structured data: `SoftwareApplication`, `FAQPage`, etc. | Validated with a structured-data test tool. |
| FR-SEO-03 | `llms.txt` describing the site for AI answer engines. | Present at site root, kept in sync with actual product claims (no overstated accuracy claims — ties back to FR-DETECT-03's honesty requirement). |
| FR-SEO-04 | Blog/CMS routing structure scaffolded, even with zero articles at launch. | Route exists and renders an empty-state gracefully; content authoring can start independently of app releases. |
| FR-SEO-05 | No critical content is client-render-only. | Verified by fetching marketing pages with JS disabled / view-source and confirming core content is present in the initial HTML (this is *why* we're on Next.js SSR). |

### 5.12 FR-PWA — Progressive Web App behavior

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-PWA-01 | App is installable ("Add to Home Screen") with a manifest and icons. | Passes an installability check on Chrome Android and Safari iOS. |
| FR-PWA-02 | No native app is built for v1; PWA is the mobile delivery mechanism. | — |

---

## 6. Non-functional requirements

### 6.1 Performance

| ID | Requirement |
|---|---|
| NFR-PERF-01 | Reference device class: a mid-range smartphone from 2020 or later (e.g., ~4-core mobile SoC, 4GB RAM), mid-tier mobile browser. Capture-to-scored latency ≤2 seconds on this class. |
| NFR-PERF-02 | OpenCV.js (WASM) bundle is lazy-loaded (not blocking initial page paint) with a visible loading state. |
| NFR-PERF-03 | Live corner-marker detection loop sustains ≥10fps on the reference device. |

### 6.2 Accuracy (scanning engine) — proposed initial targets

These are **engineering starting targets**, explicitly flagged as needing empirical validation against real printed/scanned sample sheets during M1 — they are not marketing guarantees and shouldn't be published externally until validated.

| ID | Requirement |
|---|---|
| NFR-ACC-01 | Corner-marker detection succeeds within 2 seconds for ≥98% of attempts under adequate lighting and ≤15° sheet tilt. |
| NFR-ACC-02 | For bubbles the engine reports with high confidence, agreement with ground truth ≥99.5%. |
| NFR-ACC-03 | **Silent misread rate** (confidently reporting a wrong value) is the single most important metric to minimize — target ≤0.5%. The system must be tuned to err toward flagging for review, never toward guessing. This principle overrides the review-flag-rate target below whenever they conflict. |
| NFR-ACC-04 | Review-queue flag rate ≤5% of bubbles under normal conditions (adequate lighting, standard pen/pencil, undamaged sheet) — a target to tune toward, not a hard ceiling enforced by degrading NFR-ACC-03. |

### 6.3 Security

See `docs/ARCHITECTURE.md` §8–§11 for the full design and threat model. Requirements summary:

| ID | Requirement |
|---|---|
| NFR-SEC-01 | Full multi-tenant data isolation at the database level for every table that holds tenant-scoped data — no exceptions, enforced with Postgres Row-Level Security as defense-in-depth on top of app-layer scoping. |
| NFR-SEC-02 | All student data and exam content is AES-256 encrypted client-side before any network transmission. |
| NFR-SEC-03 | `drive.file` OAuth scope only — enforced by an automated check that fails CI if the requested Google OAuth scope list changes without explicit sign-off (see TASKS.md M7). |
| NFR-SEC-04 | Rate limiting and upload/input validation on all backend endpoints. |
| NFR-SEC-05 | No student PII ever reaches server logs, crash reports, or analytics tooling — enforced by a scrubbing layer, not just "don't log it" convention, since accidental logging (e.g., logging a full request body on error) is one of the most common real-world PII leak vectors. |
| NFR-SEC-06 | Export files (CSV/Excel) sanitize any cell value beginning with `=`, `+`, `-`, or `@` to prevent CSV/formula-injection attacks against Excel/Sheets. This is a real, frequently-missed vulnerability class and is explicitly in scope for FR-RESULTS-04. |
| NFR-SEC-07 | Free-tier usage enforcement (FR-BILLING-06) is **soft**: client-reported counters with optimistic offline buffering and authoritative server reconciliation when online, not a hard per-scan gate (a hard gate would require a server round-trip before every capture, undermining the offline-first and zero-per-scan-server-dependency goals). Determined client-side tampering to bypass the free-tier cap is an accepted risk at this price point, consistent with how most freemium SaaS products treat client-enforced limits — not something to over-engineer DRM-style protection against. **Founder-confirmed refinement:** the cap is never enforced mid-scan or mid-session, even once the server-side count confirms it's exceeded — a teacher is never cut off partway through grading a class. The limit warning surfaces only at the *next* session start (app open) or on the dashboard, never as an interruption during active scanning (`docs/reports/SHARLO-M0-007.md`). |
| NFR-SEC-08 | Signed, expiring URLs for any exports/downloads that transit our backend. |
| NFR-SEC-09 | Admin panel requires 2FA/passkey; every admin action is authorized server-side and audit-logged (see FR-ADMIN-01/02). |
| NFR-SEC-10 | Dependency versions pinned, lockfile committed, and automated dependency vulnerability scanning (e.g., `npm audit` / Dependabot/Renovate) wired into CI. |
| NFR-SEC-11 | Signed/verified webhook payloads for both Paddle and Bank Alfalah — no billing state change is trusted from an unverified webhook call. |

### 6.4 Privacy & compliance posture

| ID | Requirement |
|---|---|
| NFR-PRIV-01 | Sharlo acts as a **data processor**, not a data controller, for student data — the teacher/school is the controller responsible for any parental/institutional consent required under local law (this is materially strengthened by the fact that student data lives in the *teacher's own* Google Drive, not on our infrastructure, under FERPA's typical "school official" framing and similar frameworks elsewhere). This posture must be reflected accurately in the Privacy Policy — legal review recommended before launch, not just an engineering assumption. |
| NFR-PRIV-02 | Because our servers are architecturally unable to decrypt student data, this is a genuine, defensible privacy claim to make publicly — not just a policy statement (ties to FR-ADMIN-11). |
| NFR-PRIV-03 | Teacher has a self-service "delete all my data" option, and a documented data retention/deletion policy exists. |

### 6.5 Reliability & offline behavior

| ID | Requirement |
|---|---|
| NFR-REL-01 | Scanning functions fully offline; only Drive sync and license/usage reconciliation require connectivity, and both are queued/retried, never blocking or losing captured data. |
| NFR-REL-02 | A teacher closing the browser tab mid-session does not lose already-resolved results; in-progress Review Queue state for the current session may be lost and this is communicated in the UI (not a silent data-loss risk). |

### 6.6 Usability & compatibility

| ID | Requirement |
|---|---|
| NFR-USE-01 | Fully usable on Chrome (Android), Safari (iOS), and major desktop browsers (Chrome, Firefox, Safari, Edge). |
| NFR-USE-02 | Mobile-first responsive layout for all in-scanning-flow screens; desktop-optimized layout for results/analytics/admin. |
| NFR-USE-03 | Manual "Take Photo" fallback always available (FR-SCAN-04) since auto-capture reliability varies by device/lighting. |

### 6.7 Scalability

| ID | Requirement |
|---|---|
| NFR-SCALE-01 | Because scanning/detection is 100% client-side, per-scan marginal server cost is ~zero — server load scales with account/billing/admin activity, not scan volume. This is a deliberate cost-architecture choice, not an afterthought (see ADR-0001). |
| NFR-SCALE-02 | Postgres schema and API design should comfortably support tens of thousands of teacher accounts on a single small-to-mid VPS before any horizontal-scaling work is needed (explicit non-goal: don't build for millions of users on day one). |

---

## 7. Acceptance criteria — Definition of Done template

Every task in `docs/TASKS.md` inherits this baseline Definition of Done in addition to its own specific acceptance criteria:

1. Code implements the linked FR/NFR IDs from this document.
2. `npm run ci` (lint + typecheck + tests) passes locally before push.
3. Automated tests cover the acceptance criteria stated for the requirement, where testable.
4. No new server-side code path touches plaintext student data (verified by reviewer/self-review against §4's data classification table).
5. CI is green on the pushed branch (`gh run watch --exit-status` or equivalent).
6. A report exists at `docs/reports/<task-id>.md` per the workflow in the kickoff prompt.

---

## 8. Key decisions — status

Originally surfaced as open questions; all resolved by the founder as of `docs/reports/SHARLO-M0-007.md`. Kept here as a log rather than deleted, since future sessions should be able to see what was decided and why without archaeology.

1. **Master-key wrapping "by the account password"** — **RESOLVED, CONFIRMED.** Encryption Passphrase, separate from Google login (FR-AUTH-04, ADR-0005, now Accepted). Founder additionally required a proactive Recovery Key reminder cadence (FR-AUTH-09) — accepted the permanent-data-loss risk of losing both the passphrase and Recovery Key as inherent to real zero-knowledge encryption, not something to engineer around.
2. **School plan's "school-wide results" dashboard** — **RESOLVED, CONFIRMED.** Dual-encryption to both the teacher's key and a school key (ADR-0010, now Accepted), with the school-key copies stored in a Drive location the *school admin* owns (Shared Drive preferred, folder fallback) rather than in individual teachers' Drives — founder's explicit reasoning: institutional data continuity must not depend on any one teacher's account. See FR-SCHOOL-01–05.
3. **Offline-first scanning** (FR-SCAN-06, NFR-REL-01) — **APPROVED AS A CONCEPT, DEFERRED.** Not in v1 launch scope; moved to backlog for a later milestone (`docs/TASKS.md`).
4. **PPP tier placement of UAE/Saudi/Qatar** — **RESEARCHED.** See `docs/reports/SHARLO-M0-007.md` for sourced teacher-salary data and a recommended pricing split (institutional School pricing vs. individual Pro pricing) awaiting the founder's final numbers lock.

**Still open, non-blocking:** the admin-subdomain network-layer hardening recommendation (`docs/ARCHITECTURE.md` §11, task M7-007) has not been explicitly addressed either way and remains a founder call whenever M7 is reached.

---

## 9. Traceability

Every requirement ID in this document (`FR-*`, `NFR-*`) is referenced by at least one task ID in `docs/TASKS.md`. Architecture decisions that implement these requirements are documented in `docs/ARCHITECTURE.md` and `docs/ADR/`.

---

## 10. Out of scope for this launch

Restated from the kickoff prompt for completeness (do not build):

- Native mobile apps (Android/iOS) — web-only, including PWA "Add to Home Screen."
- WhatsApp auto-send/notification automation.
- Stripe, PayPal integrations.
- Supabase or any paid BaaS.
- Server-side OCR/vision APIs of any kind.
- Easypaisa/JazzCash (architecture must not block adding them later, but they are not built now).

If any of the above turns out to actually be needed, or anything in-scope should be cut, that's a stop-and-flag situation per the kickoff prompt's own rule — not a unilateral call.

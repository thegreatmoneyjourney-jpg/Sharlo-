# ADR-0011: Resend for transactional email

**Status:** Accepted

## Context

Until now, the architecture had no transactional-email component — auth is Google OAuth (Google handles its own emails) and nothing else in the original spec required us to send mail. The founder's confirmation of ADR-0005 added a requirement: Recovery Key reminders at 7 and 30 days must go out by **email**, not just an in-app banner, specifically to reach teachers who haven't logged back in (the population most at risk of never saving their Recovery Key properly) — see the addendum in `docs/ADR/0005-client-side-encryption-key-management.md`. This is a genuinely new infrastructure dependency, not a detail of an existing one, so it gets its own ADR.

Likely near-term uses beyond the Recovery Key reminder: payment-failure notices, refund confirmations, School-plan seat invitations (a teacher needs an email invite to join a school), and account-deletion confirmations (NFR-PRIV-03). None of these carry student data — all are account/billing/lifecycle notifications, consistent with the data-classification boundary in `docs/ARCHITECTURE.md` §4.

## Decision

**Resend** for all transactional email, called server-side from the Fastify API (this is one of the few places the backend does something proactive rather than just responding to requests — see the scheduled-job note below).

## Alternatives considered

- **Amazon SES.** Cheaper at high volume and a reasonable long-term option if email volume grows substantially, but requires an AWS production-access request/approval before it can send to unverified addresses at real volume, and a comparatively rawer API/DX. Not justified at launch scale; worth revisiting if volume/cost later makes SES's per-email price advantage material.
- **Postmark.** Comparable developer experience to Resend, strong deliverability reputation, but a less generous free tier at this project's expected early volume, with no other differentiator strong enough to prefer it here.
- **Rolling our own SMTP (e.g., via Postfix on the same VPS).** Rejected — deliverability (getting into inboxes, not spam folders) is a genuinely hard, ongoing operational problem (IP reputation, DKIM/SPF/DMARC upkeep) that a dedicated provider solves far more reliably than a solo founder should take on for a problem this far from the core product.

## Consequences

- One more external dependency and one more piece of domain configuration (DKIM/SPF/DMARC records for the sending domain) needed before any email-dependent feature (Recovery Key reminders, school invites) can ship — tracked as an M0 infrastructure task (`docs/TASKS.md` M0-008) alongside the rest of the base infra, not bundled invisibly into a feature task.
- Sending Recovery Key reminders on a schedule (7-day/30-day, `docs/ADR/0005-client-side-encryption-key-management.md` addendum) requires a scheduled-job mechanism on the backend. Given the deliberately lightweight infra (`docs/ARCHITECTURE.md` §12 — Docker Compose, no Kubernetes), a simple in-process daily scheduler (e.g., `node-cron` inside the Fastify app, or a scheduled container invocation via system cron hitting an internal admin-only endpoint) is sufficient at this scale — no separate job-queue infrastructure (e.g., a message broker) is justified yet.
- Email content templates must go through the same "no student data" discipline as everything else — easy to forget for something as innocuous-seeming as a reminder email, so worth stating explicitly: no email this system sends ever includes a student name, roll number, or exam content, only account-level information (the teacher's own name/email, plan status, reminders about their own credentials).

## Addendum: sending-domain reputation guardrails + role inboxes (founder-required, added post-acceptance, Addendum 3)

Two explicit constraints on how this ADR's decision is operated, prompted by patterns that are tempting under cost or volume pressure but would put the sending domain's deliverability at risk for every user, not just the one being over-served:

- **Never self-host an SMTP/mail server on the VPS**, not even to supplement Resend for some traffic. Re-affirms this ADR's original "rolling our own SMTP" rejection above — a fresh VPS IP has no sender reputation, and a login-OTP or password-reset email landing in spam (or being rejected outright) is a correctness-breaking failure, not a degraded-experience one: a user who can't receive their OTP cannot log in at all.
- **Never rotate sending across multiple provider accounts once one hits a volume cap.** This pattern (spinning up a second/third Resend-or-equivalent account to route around a free-tier limit) reads to mail providers as spam-evasion behavior and risks the entire sending domain being flagged — a reputation hit that takes months to recover from and would break deliverability for every user, not just the one who pushed volume over the cap. The correct response to outgrowing Resend's free tier is upgrading to a paid Resend tier, full stop.

Additionally:

- **Role-based inboxes** (`support@`, `billing@`, `hello@[domain]`) on the same sending domain are explicitly encouraged for a professional appearance, provisioned through a free-tier **hosted** mail provider (e.g., Zoho Mail's free single-user tier) — not self-hosted, for the same reputation/deliverability reasoning above. Tracked in `docs/TASKS.md` M0-008 alongside the rest of this ADR's infra.
- **SPF, DKIM, and DMARC must be correctly configured for the sending domain**, covering both Resend's transactional sending and the role-based inboxes — this was already implicit in this ADR's "Consequences" section above but is restated here as an explicit, non-optional requirement, not polish.
- The Resend API key (and every other integration credential going forward — Paddle, a future AI provider) is stored via the encrypted, admin-writable credential store (`docs/TASKS.md` M0-010, `ADR-0017`), never as a plaintext environment variable requiring a redeploy to add, rotate, or revoke.

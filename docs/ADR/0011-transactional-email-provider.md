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

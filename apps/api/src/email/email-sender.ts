/**
 * ADR-0011 — a provider-agnostic sending interface, the same shape as
 * `docs/ARCHITECTURE.md` §10's `PaymentProviderAdapter` pattern: the rest
 * of the app depends on this interface, never on Resend directly, so a
 * future provider swap (or a test double) is a second implementation, not
 * a rewrite of every call site.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

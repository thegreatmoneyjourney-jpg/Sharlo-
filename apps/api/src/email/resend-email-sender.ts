import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getCredential } from '../integrations/credential-store.js';
import type * as schema from '../db/schema.js';
import type { EmailMessage, EmailSender } from './email-sender.js';

type Db = PostgresJsDatabase<typeof schema>;

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * ADR-0011's real Resend HTTP integration — the "wired in" half of
 * `M3-004`'s founder-required split. The API key and sending address come
 * from the encrypted `integration_credentials` store (`ADR-0017`), never a
 * hardcoded env var, via the same `getCredential` helper `google-oauth`
 * already uses for its own secrets.
 *
 * `M0-008` (domain/DNS/Resend account) has not been provisioned yet, so
 * `getCredential` will throw ("No integration credential stored...") on
 * every call until it is — that's expected, not a bug to work around here.
 * Every caller (`../scheduler/recovery-key-reminders.ts`) is written to
 * catch that failure per-recipient and retry on the next sweep, rather
 * than assuming this class can currently send anything for real.
 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const [apiKey, fromAddress] = await Promise.all([
      getCredential(this.db, 'resend', 'api_key'),
      getCredential(this.db, 'resend', 'from_address'),
    ]);

    const response = await this.fetchImpl(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable response body>');
      throw new Error(`Resend API request failed (HTTP ${response.status}): ${body}`);
    }
  }
}

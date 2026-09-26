import type { EmailMessage } from './email-sender.js';

/**
 * ADR-0011: "no email this system sends ever includes a student name, roll
 * number, or exam content, only account-level information" — this message
 * carries only the teacher's own email and a link back to their own
 * settings page, nothing about their classes/exams/students.
 */
export function buildRecoveryKeyReminderEmail(
  toEmail: string,
  daysSinceIssued: 7 | 30,
  appBaseUrl: string,
): EmailMessage {
  const settingsUrl = `${appBaseUrl}/settings`;
  const subject =
    daysSinceIssued === 30
      ? 'Final reminder: confirm your Sharlo Recovery Key is saved'
      : 'Reminder: confirm your Sharlo Recovery Key is saved';
  const text =
    `It's been ${daysSinceIssued} days since you set up encryption on your Sharlo account.\n\n` +
    `If you ever forget your Encryption Passphrase, your Recovery Key is the only other way to ` +
    `access your data — and if you lose both, your data is permanently unrecoverable, by anyone, ` +
    `including us.\n\n` +
    `Please take a moment to confirm you still have it saved: ${settingsUrl}\n`;
  const html =
    `<p>It's been ${daysSinceIssued} days since you set up encryption on your Sharlo account.</p>` +
    `<p>If you ever forget your Encryption Passphrase, your Recovery Key is the only other way to ` +
    `access your data — and if you lose both, your data is permanently unrecoverable, by anyone, ` +
    `including us.</p>` +
    `<p><a href="${settingsUrl}">Confirm your Recovery Key is saved</a></p>`;
  return { to: toEmail, subject, html, text };
}

import type { EmailMessage } from './email-sender.js';

/** `ADR-0018` — the sign-in code email. Account-level content only (`ADR-0011`), same as every other transactional email this app sends. */
export function buildEmailOtpMessage(toEmail: string, code: string): EmailMessage {
  const subject = `Your Sharlo sign-in code: ${code}`;
  const text =
    `Your Sharlo sign-in code is: ${code}\n\n` +
    `This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.\n`;
  const html =
    `<p>Your Sharlo sign-in code is:</p>` +
    `<p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${code}</p>` +
    `<p>This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>`;
  return { to: toEmail, subject, html, text };
}

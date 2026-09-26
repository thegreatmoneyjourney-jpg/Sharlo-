import { describe, expect, it } from 'vitest';
import { buildRecoveryKeyReminderEmail } from '../src/email/recovery-key-reminder-email.js';

describe('buildRecoveryKeyReminderEmail', () => {
  it('addresses the message to the given teacher email', () => {
    const message = buildRecoveryKeyReminderEmail(
      'teacher@example.com',
      7,
      'https://app.example.com',
    );
    expect(message.to).toBe('teacher@example.com');
  });

  it('links back to the settings page on the given app base URL', () => {
    const message = buildRecoveryKeyReminderEmail(
      'teacher@example.com',
      7,
      'https://app.example.com',
    );
    expect(message.text).toContain('https://app.example.com/settings');
    expect(message.html).toContain('https://app.example.com/settings');
  });

  it('marks the 30-day reminder as a final reminder in the subject, unlike the 7-day one', () => {
    const sevenDay = buildRecoveryKeyReminderEmail(
      'teacher@example.com',
      7,
      'https://app.example.com',
    );
    const thirtyDay = buildRecoveryKeyReminderEmail(
      'teacher@example.com',
      30,
      'https://app.example.com',
    );
    expect(sevenDay.subject).not.toMatch(/final/i);
    expect(thirtyDay.subject).toMatch(/final/i);
  });

  it('never mentions students, rolls, classes, or exams — account-level content only (ADR-0011)', () => {
    const message = buildRecoveryKeyReminderEmail(
      'teacher@example.com',
      30,
      'https://app.example.com',
    );
    const combined = `${message.subject} ${message.text} ${message.html}`.toLowerCase();
    // Word-boundary match: the app base URL itself contains "exam" as a
    // substring ("ex-AM-ple.com"), which a plain .toContain check would
    // wrongly flag as this test's own bug, not a real product issue.
    for (const forbidden of ['student', 'roll', 'class', 'exam']) {
      expect(combined).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });

  it('provides both html and text bodies', () => {
    const message = buildRecoveryKeyReminderEmail(
      'teacher@example.com',
      7,
      'https://app.example.com',
    );
    expect(message.html.length).toBeGreaterThan(0);
    expect(message.text.length).toBeGreaterThan(0);
  });
});

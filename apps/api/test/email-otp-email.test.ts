import { describe, expect, it } from 'vitest';
import { buildEmailOtpMessage } from '../src/email/email-otp-email.js';

describe('buildEmailOtpMessage', () => {
  it('addresses the message to the given email', () => {
    const message = buildEmailOtpMessage('teacher@example.com', '123456');
    expect(message.to).toBe('teacher@example.com');
  });

  it('includes the code in the subject, text, and html bodies', () => {
    const message = buildEmailOtpMessage('teacher@example.com', '123456');
    expect(message.subject).toContain('123456');
    expect(message.text).toContain('123456');
    expect(message.html).toContain('123456');
  });

  it('states the 10-minute expiry', () => {
    const message = buildEmailOtpMessage('teacher@example.com', '123456');
    expect(message.text).toMatch(/10 minutes/);
    expect(message.html).toMatch(/10 minutes/);
  });

  it('never mentions students, rolls, classes, or exams — account-level content only (ADR-0011)', () => {
    const message = buildEmailOtpMessage('teacher@example.com', '123456');
    const combined = `${message.subject} ${message.text} ${message.html}`.toLowerCase();
    for (const forbidden of ['student', 'roll', 'class', 'exam']) {
      expect(combined).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });

  it('provides both html and text bodies', () => {
    const message = buildEmailOtpMessage('teacher@example.com', '123456');
    expect(message.html.length).toBeGreaterThan(0);
    expect(message.text.length).toBeGreaterThan(0);
  });
});

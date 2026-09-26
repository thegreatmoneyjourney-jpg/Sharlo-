import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignInClient from './signin-client';

const { requestEmailOtpMock, verifyEmailOtpMock } = vi.hoisted(() => ({
  requestEmailOtpMock: vi.fn(),
  verifyEmailOtpMock: vi.fn(),
}));

vi.mock('@/lib/api/email-otp-client', () => ({
  requestEmailOtp: requestEmailOtpMock,
  verifyEmailOtp: verifyEmailOtpMock,
}));

beforeEach(() => {
  requestEmailOtpMock.mockReset();
  verifyEmailOtpMock.mockReset();
  // jsdom's real Location object doesn't perform navigation and leaves
  // `href` unchanged on assignment (only logging "Not implemented") —
  // swapping in a plain writable object lets the test observe the
  // assignment the component actually makes, without jsdom's gap.
  Object.defineProperty(window, 'location', { writable: true, value: { href: '' } });
});

afterEach(() => {
  cleanup();
});

async function goToLocalOnlyEmailScreen() {
  fireEvent.click(screen.getByRole('button', { name: /continue without a google account/i }));
  return screen.findByLabelText(/email address/i);
}

async function requestCodeFor(email: string) {
  const input = await goToLocalOnlyEmailScreen();
  fireEvent.change(input, { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: /send sign-in code/i }));
  await screen.findByText(new RegExp(email));
}

describe('SignInClient', () => {
  it('shows a Google sign-in link and a local-only option on the choice screen', () => {
    render(<SignInClient />);
    const googleLink = screen.getByRole('link', { name: /continue with google/i });
    expect(googleLink).toHaveAttribute('href', expect.stringContaining('/auth/google/start'));
    expect(
      screen.getByRole('button', { name: /continue without a google account/i }),
    ).toBeInTheDocument();
  });

  it('shows the email form after choosing local-only', async () => {
    render(<SignInClient />);
    await goToLocalOnlyEmailScreen();
    expect(screen.getByRole('button', { name: /send sign-in code/i })).toBeInTheDocument();
  });

  it('requests a code and advances to the code-entry screen', async () => {
    requestEmailOtpMock.mockResolvedValue(undefined);
    render(<SignInClient />);

    await requestCodeFor('teacher@example.com');

    expect(requestEmailOtpMock).toHaveBeenCalledWith('teacher@example.com');
    expect(screen.getByLabelText(/sign-in code/i)).toBeInTheDocument();
  });

  it('shows an error if requesting a code fails', async () => {
    requestEmailOtpMock.mockRejectedValue(new Error('boom'));
    render(<SignInClient />);

    const input = await goToLocalOnlyEmailScreen();
    fireEvent.change(input, { target: { value: 'teacher@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send sign-in code/i }));

    await screen.findByText(/could not send a code/i);
  });

  it('redirects to /settings on a successful code verification', async () => {
    requestEmailOtpMock.mockResolvedValue(undefined);
    verifyEmailOtpMock.mockResolvedValue('success');
    render(<SignInClient />);

    await requestCodeFor('teacher@example.com');
    fireEvent.change(screen.getByLabelText(/sign-in code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await vi.waitFor(() =>
      expect(verifyEmailOtpMock).toHaveBeenCalledWith('teacher@example.com', '123456'),
    );
    await vi.waitFor(() => expect(window.location.href).toContain('/settings'));
  });

  it('shows a wrong-code message for an invalid_code outcome', async () => {
    requestEmailOtpMock.mockResolvedValue(undefined);
    verifyEmailOtpMock.mockResolvedValue('invalid_code');
    render(<SignInClient />);

    await requestCodeFor('teacher@example.com');
    fireEvent.change(screen.getByLabelText(/sign-in code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await screen.findByText(/that code is incorrect/i);
  });

  it('suggests Google sign-in for a wrong_provider outcome', async () => {
    requestEmailOtpMock.mockResolvedValue(undefined);
    verifyEmailOtpMock.mockResolvedValue('wrong_provider');
    render(<SignInClient />);

    await requestCodeFor('teacher@example.com');
    fireEvent.change(screen.getByLabelText(/sign-in code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await screen.findByText(/use "continue with google" instead/i);
  });

  it('returns to the email screen when "use a different email" is clicked', async () => {
    requestEmailOtpMock.mockResolvedValue(undefined);
    render(<SignInClient />);

    await requestCodeFor('teacher@example.com');
    fireEvent.click(
      screen.getByRole('button', { name: /use a different email or request a new code/i }),
    );

    expect(screen.getByRole('button', { name: /send sign-in code/i })).toBeInTheDocument();
  });

  it('returns to the choice screen when "back" is clicked', async () => {
    render(<SignInClient />);
    await goToLocalOnlyEmailScreen();

    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));

    expect(
      screen.getByRole('button', { name: /continue without a google account/i }),
    ).toBeInTheDocument();
  });
});

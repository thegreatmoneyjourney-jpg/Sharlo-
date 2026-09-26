import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecoveryKeyReminderBanner from './recovery-key-reminder-banner';

const { fetchRecoveryKeyReminderStatusMock } = vi.hoisted(() => ({
  fetchRecoveryKeyReminderStatusMock: vi.fn(),
}));

vi.mock('@/lib/api/account-encryption-client', () => ({
  fetchRecoveryKeyReminderStatus: fetchRecoveryKeyReminderStatusMock,
}));

beforeEach(() => {
  fetchRecoveryKeyReminderStatusMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('RecoveryKeyReminderBanner', () => {
  it('renders nothing while the status is loading, and nothing if showBanner is false', async () => {
    fetchRecoveryKeyReminderStatusMock.mockResolvedValue({ showBanner: false });
    const { container } = render(<RecoveryKeyReminderBanner />);
    expect(container).toBeEmptyDOMElement();
    await vi.waitFor(() => expect(fetchRecoveryKeyReminderStatusMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing if the status fetch fails (e.g. signed out) — a soft nudge, not a gate', async () => {
    fetchRecoveryKeyReminderStatusMock.mockRejectedValue(new Error('401'));
    const { container } = render(<RecoveryKeyReminderBanner />);
    await vi.waitFor(() => expect(fetchRecoveryKeyReminderStatusMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the banner with a link to /settings#recovery-key when showBanner is true', async () => {
    fetchRecoveryKeyReminderStatusMock.mockResolvedValue({ showBanner: true });
    render(<RecoveryKeyReminderBanner />);
    const link = await screen.findByRole('link', { name: /review it now/i });
    expect(link).toHaveAttribute('href', '/settings#recovery-key');
  });

  it('hides the banner for this view when the dismiss button is clicked', async () => {
    fetchRecoveryKeyReminderStatusMock.mockResolvedValue({ showBanner: true });
    render(<RecoveryKeyReminderBanner />);
    await screen.findByRole('link', { name: /review it now/i });

    fireEvent.click(screen.getByRole('button', { name: /dismiss for now/i }));

    expect(screen.queryByRole('link', { name: /review it now/i })).not.toBeInTheDocument();
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocalOnlyWarningBanner from './local-only-warning-banner';

const { fetchAccountInfoMock } = vi.hoisted(() => ({
  fetchAccountInfoMock: vi.fn(),
}));

vi.mock('@/lib/api/account-client', () => ({
  fetchAccountInfo: fetchAccountInfoMock,
}));

beforeEach(() => {
  fetchAccountInfoMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('LocalOnlyWarningBanner', () => {
  it('renders nothing while loading, and nothing for a Google-authenticated account', async () => {
    fetchAccountInfoMock.mockResolvedValue({ authMode: 'google' });
    const { container } = render(<LocalOnlyWarningBanner />);
    expect(container).toBeEmptyDOMElement();
    await vi.waitFor(() => expect(fetchAccountInfoMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing if the fetch fails (e.g. signed out)', async () => {
    fetchAccountInfoMock.mockRejectedValue(new Error('401'));
    const { container } = render(<LocalOnlyWarningBanner />);
    await vi.waitFor(() => expect(fetchAccountInfoMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the unmissable warning for a local-only account, with a link to the backup section', async () => {
    fetchAccountInfoMock.mockResolvedValue({ authMode: 'local_only' });
    render(<LocalOnlyWarningBanner />);

    await screen.findByText(/local-only account/i);
    const link = screen.getByRole('link', { name: /export a backup file/i });
    expect(link).toHaveAttribute('href', '/settings#backup');
  });

  it('has no dismiss control — unlike the Recovery Key banner, this warning is never hideable', async () => {
    fetchAccountInfoMock.mockResolvedValue({ authMode: 'local_only' });
    render(<LocalOnlyWarningBanner />);

    await screen.findByText(/local-only account/i);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

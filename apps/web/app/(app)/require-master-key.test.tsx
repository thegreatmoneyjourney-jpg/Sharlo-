import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RequireMasterKey } from './require-master-key';
import type { MasterKeyState } from './use-master-key';

const { useMasterKeyMock } = vi.hoisted(() => ({ useMasterKeyMock: vi.fn() }));

vi.mock('./use-master-key', () => ({ useMasterKey: useMasterKeyMock }));

function mockState(state: MasterKeyState) {
  useMasterKeyMock.mockReturnValue({ state, unlock: vi.fn(), lock: vi.fn() });
}

describe('RequireMasterKey', () => {
  it('renders a loading message while loading', () => {
    mockState({ status: 'loading' });
    render(<RequireMasterKey>{() => <p>children</p>}</RequireMasterKey>);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('links to /signin when signed out', () => {
    mockState({ status: 'signed-out' });
    render(<RequireMasterKey>{() => <p>children</p>}</RequireMasterKey>);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/signin');
  });

  it('links to /settings when encryption needs setup', () => {
    mockState({ status: 'needs-setup' });
    render(<RequireMasterKey>{() => <p>children</p>}</RequireMasterKey>);
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings');
  });

  it('shows the error message on error', () => {
    mockState({ status: 'error', message: 'Something broke.' });
    render(<RequireMasterKey>{() => <p>children</p>}</RequireMasterKey>);
    expect(screen.getByText('Something broke.')).toBeInTheDocument();
  });

  it('renders the unlock prompt when locked', () => {
    mockState({ status: 'locked' });
    render(<RequireMasterKey>{() => <p>children</p>}</RequireMasterKey>);
    expect(screen.getByLabelText(/encryption passphrase/i)).toBeInTheDocument();
  });

  it('renders children with the master key once unlocked', () => {
    const masterKey = new Uint8Array(32);
    mockState({ status: 'unlocked', masterKey });
    render(<RequireMasterKey>{(key) => <p>got {key.length} bytes</p>}</RequireMasterKey>);
    expect(screen.getByText('got 32 bytes')).toBeInTheDocument();
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMasterKey } from './use-master-key';
import {
  _resetMasterKeySessionForTests,
  getCachedMasterKey,
  setCachedMasterKey,
} from '@/lib/crypto/master-key-session';

const { fetchEncryptionParamsMock, unwrapMasterKeyByPassphraseMock } = vi.hoisted(() => ({
  fetchEncryptionParamsMock: vi.fn(),
  unwrapMasterKeyByPassphraseMock: vi.fn(),
}));

vi.mock('@/lib/api/account-encryption-client', () => ({
  fetchEncryptionParams: fetchEncryptionParamsMock,
}));

vi.mock('@/lib/crypto/master-key', () => ({
  unwrapMasterKeyByPassphrase: unwrapMasterKeyByPassphraseMock,
}));

const STORED_PARAMS = {
  hasEncryptionSetup: true,
  wrappedMasterKeyByPassphrase: 'aa',
  wrappedMasterKeyByRecovery: 'bb',
  kdfSalt: 'cc',
  kdfParams: { algorithm: 'argon2id' as const, opsLimit: 3, memLimit: 1 },
};

beforeEach(() => {
  fetchEncryptionParamsMock.mockReset();
  unwrapMasterKeyByPassphraseMock.mockReset();
});

afterEach(() => {
  _resetMasterKeySessionForTests();
});

describe('useMasterKey', () => {
  it('resolves to needs-setup when the account has no encryption set up yet', async () => {
    fetchEncryptionParamsMock.mockResolvedValue({ hasEncryptionSetup: false });
    const { result } = renderHook(() => useMasterKey());

    expect(result.current.state).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.state.status).toBe('needs-setup'));
  });

  it('resolves to signed-out on a 401', async () => {
    fetchEncryptionParamsMock.mockRejectedValue(new Error('Failed (HTTP 401)'));
    const { result } = renderHook(() => useMasterKey());

    await waitFor(() => expect(result.current.state.status).toBe('signed-out'));
  });

  it('resolves to error on any other failure', async () => {
    fetchEncryptionParamsMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useMasterKey());

    await waitFor(() => expect(result.current.state.status).toBe('error'));
  });

  it('resolves to locked when encryption is set up and nothing is cached yet', async () => {
    fetchEncryptionParamsMock.mockResolvedValue(STORED_PARAMS);
    const { result } = renderHook(() => useMasterKey());

    await waitFor(() => expect(result.current.state.status).toBe('locked'));
  });

  it('unlocks with the correct passphrase, caching the master key', async () => {
    fetchEncryptionParamsMock.mockResolvedValue(STORED_PARAMS);
    const masterKey = new Uint8Array(32);
    unwrapMasterKeyByPassphraseMock.mockResolvedValue(masterKey);
    const { result } = renderHook(() => useMasterKey());
    await waitFor(() => expect(result.current.state.status).toBe('locked'));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.unlock('correct-passphrase');
    });

    expect(outcome).toBe('ok');
    expect(result.current.state).toEqual({ status: 'unlocked', masterKey });
    expect(unwrapMasterKeyByPassphraseMock).toHaveBeenCalledWith('correct-passphrase', {
      wrappedMasterKeyByPassphrase: STORED_PARAMS.wrappedMasterKeyByPassphrase,
      kdfSalt: STORED_PARAMS.kdfSalt,
      kdfParams: STORED_PARAMS.kdfParams,
    });
    expect(getCachedMasterKey()).toBe(masterKey);
  });

  it('reports wrong-passphrase without unlocking on a failed unwrap', async () => {
    fetchEncryptionParamsMock.mockResolvedValue(STORED_PARAMS);
    unwrapMasterKeyByPassphraseMock.mockRejectedValue(new Error('bad passphrase'));
    const { result } = renderHook(() => useMasterKey());
    await waitFor(() => expect(result.current.state.status).toBe('locked'));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.unlock('wrong-passphrase');
    });

    expect(outcome).toBe('wrong-passphrase');
    expect(result.current.state.status).toBe('locked');
    expect(getCachedMasterKey()).toBeNull();
  });

  it('starts directly at unlocked, skipping the network call, when a key is already cached', async () => {
    setCachedMasterKey(new Uint8Array(32));
    const { result } = renderHook(() => useMasterKey());

    await waitFor(() => expect(result.current.state.status).toBe('unlocked'));
    expect(fetchEncryptionParamsMock).not.toHaveBeenCalled();
  });

  it('lock() clears the cache and returns to locked', async () => {
    setCachedMasterKey(new Uint8Array(32));
    const { result } = renderHook(() => useMasterKey());
    await waitFor(() => expect(result.current.state.status).toBe('unlocked'));

    act(() => {
      result.current.lock();
    });

    expect(result.current.state).toEqual({ status: 'locked' });
    expect(getCachedMasterKey()).toBeNull();
  });
});

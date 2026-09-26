import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchEncryptionParams,
  fetchRecoveryKeyReminderStatus,
  submitEncryptionSetup,
  submitPassphraseChange,
  submitRecoveryKeyReminderConfirm,
} from './account-encryption-client';

describe('account-encryption-client', () => {
  beforeEach(() => {
    document.cookie = 'sharlo_csrf=test-csrf-token-value';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'sharlo_csrf=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  });

  it('fetchEncryptionParams sends credentials and returns the parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hasEncryptionSetup: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchEncryptionParams();

    expect(result).toEqual({ hasEncryptionSetup: false });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.credentials).toBe('include');
  });

  it('fetchEncryptionParams throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(fetchEncryptionParams()).rejects.toThrow(/401/);
  });

  it('submitEncryptionSetup echoes the CSRF cookie as a header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await submitEncryptionSetup({
      wrappedMasterKeyByPassphrase: 'ab',
      wrappedMasterKeyByRecovery: 'cd',
      kdfSalt: 'ef',
      kdfParams: { algorithm: 'argon2id', opsLimit: 1, memLimit: 1 },
      recoveryKeyVerifier: '12',
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.credentials).toBe('include');
    expect(options.headers['x-csrf-token']).toBe('test-csrf-token-value');
  });

  it('submitPassphraseChange posts to the passphrase-change endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await submitPassphraseChange({
      wrappedMasterKeyByPassphrase: 'ab',
      kdfSalt: 'ef',
      kdfParams: { algorithm: 'argon2id', opsLimit: 1, memLimit: 1 },
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/account/encryption-passphrase');
  });

  it('submitPassphraseChange throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }));
    await expect(
      submitPassphraseChange({
        wrappedMasterKeyByPassphrase: 'ab',
        kdfSalt: 'ef',
        kdfParams: { algorithm: 'argon2id', opsLimit: 1, memLimit: 1 },
      }),
    ).rejects.toThrow(/409/);
  });

  it('fetchRecoveryKeyReminderStatus sends credentials and returns the parsed body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ showBanner: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchRecoveryKeyReminderStatus();

    expect(result).toEqual({ showBanner: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/account/recovery-key-reminder-status');
    expect(options.credentials).toBe('include');
  });

  it('fetchRecoveryKeyReminderStatus throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(fetchRecoveryKeyReminderStatus()).rejects.toThrow(/401/);
  });

  it('submitRecoveryKeyReminderConfirm posts to the confirm endpoint with the CSRF header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await submitRecoveryKeyReminderConfirm({
      wrappedMasterKeyByRecovery: 'cd',
      recoveryKeyVerifier: '12',
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/account/recovery-key-reminder-confirm');
    expect(options.method).toBe('POST');
    expect(options.headers['x-csrf-token']).toBe('test-csrf-token-value');
  });

  it('submitRecoveryKeyReminderConfirm throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }));
    await expect(
      submitRecoveryKeyReminderConfirm({
        wrappedMasterKeyByRecovery: 'cd',
        recoveryKeyVerifier: '12',
      }),
    ).rejects.toThrow(/409/);
  });
});

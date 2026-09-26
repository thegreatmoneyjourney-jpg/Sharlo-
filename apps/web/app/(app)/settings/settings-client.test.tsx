import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsClient from './settings-client';

/**
 * Mocks both the network layer (`account-encryption-client`) and the
 * crypto layer (`master-key`) — this component test proves the settings
 * page's own state machine and wiring (which flow renders when, button
 * enablement, what gets submitted), not cryptographic correctness, which
 * `apps/web/lib/crypto/master-key.test.ts` already covers exhaustively.
 * It also sidesteps a real environment gap: jsdom (this file's test
 * environment, needed for the DOM) has no `crypto.subtle` at all, so the
 * real Argon2id/AES-GCM code can't run here regardless.
 */
const {
  fetchEncryptionParamsMock,
  submitEncryptionSetupMock,
  submitPassphraseChangeMock,
  submitRecoveryKeyReminderConfirmMock,
  setupEncryptionMock,
  unwrapMasterKeyByPassphraseMock,
  rewrapMasterKeyByNewPassphraseMock,
  rewrapMasterKeyByNewRecoveryKeyMock,
} = vi.hoisted(() => ({
  fetchEncryptionParamsMock: vi.fn(),
  submitEncryptionSetupMock: vi.fn(),
  submitPassphraseChangeMock: vi.fn(),
  submitRecoveryKeyReminderConfirmMock: vi.fn(),
  setupEncryptionMock: vi.fn(),
  unwrapMasterKeyByPassphraseMock: vi.fn(),
  rewrapMasterKeyByNewPassphraseMock: vi.fn(),
  rewrapMasterKeyByNewRecoveryKeyMock: vi.fn(),
}));

vi.mock('@/lib/api/account-encryption-client', () => ({
  fetchEncryptionParams: fetchEncryptionParamsMock,
  submitEncryptionSetup: submitEncryptionSetupMock,
  submitPassphraseChange: submitPassphraseChangeMock,
  submitRecoveryKeyReminderConfirm: submitRecoveryKeyReminderConfirmMock,
}));

vi.mock('@/lib/crypto/master-key', () => ({
  setupEncryption: setupEncryptionMock,
  unwrapMasterKeyByPassphrase: unwrapMasterKeyByPassphraseMock,
  rewrapMasterKeyByNewPassphrase: rewrapMasterKeyByNewPassphraseMock,
  rewrapMasterKeyByNewRecoveryKey: rewrapMasterKeyByNewRecoveryKeyMock,
}));

const FAKE_SETUP_RESULT = {
  wrappedMasterKeyByPassphrase: 'aa',
  wrappedMasterKeyByRecovery: 'bb',
  kdfSalt: 'cc',
  kdfParams: { algorithm: 'argon2id' as const, opsLimit: 3, memLimit: 1 },
  recoveryKeyVerifier: 'dd',
  recoveryKeyDisplay: 'aaaa-bbbb-cccc-dddd',
};

beforeEach(() => {
  fetchEncryptionParamsMock.mockReset();
  submitEncryptionSetupMock.mockReset().mockResolvedValue(undefined);
  submitPassphraseChangeMock.mockReset().mockResolvedValue(undefined);
  submitRecoveryKeyReminderConfirmMock.mockReset().mockResolvedValue(undefined);
  setupEncryptionMock.mockReset().mockResolvedValue(FAKE_SETUP_RESULT);
  unwrapMasterKeyByPassphraseMock.mockReset();
  rewrapMasterKeyByNewPassphraseMock.mockReset();
  rewrapMasterKeyByNewRecoveryKeyMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SettingsClient', () => {
  it('shows a sign-in link when the account has no session', async () => {
    fetchEncryptionParamsMock.mockRejectedValue(new Error('Failed to fetch (HTTP 401)'));
    render(<SettingsClient />);
    expect(await screen.findByText(/sign in/i)).toBeInTheDocument();
  });

  describe('a brand-new account (needs setup)', () => {
    beforeEach(() => {
      fetchEncryptionParamsMock.mockResolvedValue({ hasEncryptionSetup: false });
    });

    it('disables "Continue" until the passphrase meets the minimum length and both fields match', async () => {
      render(<SettingsClient />);
      const passphraseInput = await screen.findByLabelText(/^Encryption Passphrase$/i);
      const confirmInput = screen.getByLabelText(/confirm passphrase/i);
      const continueButton = screen.getByRole('button', { name: /continue/i });

      expect(continueButton).toBeDisabled();

      fireEvent.change(passphraseInput, { target: { value: 'short' } });
      fireEvent.change(confirmInput, { target: { value: 'short' } });
      expect(continueButton).toBeDisabled(); // below minimum length

      fireEvent.change(passphraseInput, { target: { value: 'a-long-enough-passphrase' } });
      fireEvent.change(confirmInput, { target: { value: 'does-not-match' } });
      expect(continueButton).toBeDisabled(); // mismatch

      fireEvent.change(confirmInput, { target: { value: 'a-long-enough-passphrase' } });
      expect(continueButton).not.toBeDisabled();
    });

    it('generates keys, shows the Recovery Key, and requires the confirmation checkbox before continuing', async () => {
      render(<SettingsClient />);
      const passphraseInput = await screen.findByLabelText(/^Encryption Passphrase$/i);
      const confirmInput = screen.getByLabelText(/confirm passphrase/i);
      fireEvent.change(passphraseInput, { target: { value: 'a-long-enough-passphrase' } });
      fireEvent.change(confirmInput, { target: { value: 'a-long-enough-passphrase' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      expect(await screen.findByText(FAKE_SETUP_RESULT.recoveryKeyDisplay)).toBeInTheDocument();
      expect(setupEncryptionMock).toHaveBeenCalledWith('a-long-enough-passphrase');

      const confirmContinueButton = screen.getByRole('button', { name: /continue/i });
      expect(confirmContinueButton).toBeDisabled();

      fireEvent.click(screen.getByRole('checkbox'));
      expect(confirmContinueButton).not.toBeDisabled();

      fireEvent.click(confirmContinueButton);

      await waitFor(() => expect(submitEncryptionSetupMock).toHaveBeenCalledTimes(1));
      expect(submitEncryptionSetupMock).toHaveBeenCalledWith({
        wrappedMasterKeyByPassphrase: FAKE_SETUP_RESULT.wrappedMasterKeyByPassphrase,
        wrappedMasterKeyByRecovery: FAKE_SETUP_RESULT.wrappedMasterKeyByRecovery,
        kdfSalt: FAKE_SETUP_RESULT.kdfSalt,
        kdfParams: FAKE_SETUP_RESULT.kdfParams,
        recoveryKeyVerifier: FAKE_SETUP_RESULT.recoveryKeyVerifier,
      });
      expect(await screen.findByText(/encryption is set up/i)).toBeInTheDocument();
    });
  });

  describe('a returning account (already set up)', () => {
    const stored = {
      wrappedMasterKeyByPassphrase: 'existing-passphrase-wrap',
      wrappedMasterKeyByRecovery: 'existing-recovery-wrap',
      kdfSalt: 'existing-salt',
      kdfParams: { algorithm: 'argon2id', opsLimit: 3, memLimit: 1 },
    };

    beforeEach(() => {
      fetchEncryptionParamsMock.mockResolvedValue({ hasEncryptionSetup: true, ...stored });
    });

    it('shows the change-passphrase form directly, not the setup flow', async () => {
      render(<SettingsClient />);
      expect(await screen.findByLabelText(/current encryption passphrase/i)).toBeInTheDocument();
      expect(screen.queryByText(/save your recovery key now/i)).not.toBeInTheDocument();
    });

    it('unwraps with the current passphrase, re-wraps with the new one, and submits the result', async () => {
      const fakeMasterKey = new Uint8Array([1, 2, 3]);
      unwrapMasterKeyByPassphraseMock.mockResolvedValue(fakeMasterKey);
      rewrapMasterKeyByNewPassphraseMock.mockResolvedValue({
        wrappedMasterKeyByPassphrase: 'new-wrap',
        kdfSalt: 'new-salt',
        kdfParams: { algorithm: 'argon2id', opsLimit: 3, memLimit: 1 },
      });

      render(<SettingsClient />);
      fireEvent.change(await screen.findByLabelText(/current encryption passphrase/i), {
        target: { value: 'my-old-passphrase' },
      });
      fireEvent.change(screen.getByLabelText(/^New Encryption Passphrase$/i), {
        target: { value: 'a-brand-new-passphrase' },
      });
      fireEvent.change(screen.getByLabelText(/confirm new passphrase/i), {
        target: { value: 'a-brand-new-passphrase' },
      });
      fireEvent.click(screen.getByRole('button', { name: /change passphrase/i }));

      await waitFor(() =>
        expect(unwrapMasterKeyByPassphraseMock).toHaveBeenCalledWith('my-old-passphrase', stored),
      );
      expect(rewrapMasterKeyByNewPassphraseMock).toHaveBeenCalledWith(
        fakeMasterKey,
        'a-brand-new-passphrase',
      );
      expect(submitPassphraseChangeMock).toHaveBeenCalledWith({
        wrappedMasterKeyByPassphrase: 'new-wrap',
        kdfSalt: 'new-salt',
        kdfParams: { algorithm: 'argon2id', opsLimit: 3, memLimit: 1 },
      });
      expect(await screen.findByText(/passphrase has been updated/i)).toBeInTheDocument();
    });

    it('shows an error and does not submit anything when the current passphrase is wrong', async () => {
      unwrapMasterKeyByPassphraseMock.mockRejectedValue(new Error('OperationError'));

      render(<SettingsClient />);
      fireEvent.change(await screen.findByLabelText(/current encryption passphrase/i), {
        target: { value: 'wrong-passphrase' },
      });
      fireEvent.change(screen.getByLabelText(/^New Encryption Passphrase$/i), {
        target: { value: 'a-brand-new-passphrase' },
      });
      fireEvent.change(screen.getByLabelText(/confirm new passphrase/i), {
        target: { value: 'a-brand-new-passphrase' },
      });
      fireEvent.click(screen.getByRole('button', { name: /change passphrase/i }));

      expect(await screen.findByText(/incorrect current passphrase/i)).toBeInTheDocument();
      expect(submitPassphraseChangeMock).not.toHaveBeenCalled();
    });

    describe('Recovery Key reconfirmation (M3-004/FR-AUTH-09)', () => {
      const fakeMasterKey = new Uint8Array([9, 9, 9]);
      const rotatedRecoveryKey = {
        recoveryKeyDisplay: 'ffff-eeee-dddd-cccc',
        wrappedMasterKeyByRecovery: 'new-recovery-wrap',
        recoveryKeyVerifier: 'new-verifier',
      };

      it('unwraps the master key, rotates the Recovery Key, and requires confirmation before submitting', async () => {
        unwrapMasterKeyByPassphraseMock.mockResolvedValue(fakeMasterKey);
        rewrapMasterKeyByNewRecoveryKeyMock.mockResolvedValue(rotatedRecoveryKey);

        render(<SettingsClient />);
        const passphraseInput = await screen.findByLabelText(
          /confirm your encryption passphrase to continue/i,
        );
        fireEvent.change(passphraseInput, { target: { value: 'my-passphrase' } });
        fireEvent.click(screen.getByRole('button', { name: /generate a new recovery key/i }));

        expect(await screen.findByText(rotatedRecoveryKey.recoveryKeyDisplay)).toBeInTheDocument();
        expect(unwrapMasterKeyByPassphraseMock).toHaveBeenCalledWith('my-passphrase', stored);
        expect(rewrapMasterKeyByNewRecoveryKeyMock).toHaveBeenCalledWith(fakeMasterKey);

        const confirmButton = screen.getByRole('button', { name: 'Confirm' });
        expect(confirmButton).toBeDisabled();

        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(confirmButton);

        // Exact-shape assertion, not just "was called": a real bug caught
        // here during this task's own development passed the whole `step`
        // object through (including the raw `recoveryKeyDisplay`) instead
        // of picking just these two fields, which would have sent the
        // plaintext Recovery Key to the server. `toHaveBeenCalledWith` on
        // an object literal fails on extra properties, not just missing
        // ones, so this guards against that regression specifically.
        await waitFor(() =>
          expect(submitRecoveryKeyReminderConfirmMock).toHaveBeenCalledWith({
            wrappedMasterKeyByRecovery: rotatedRecoveryKey.wrappedMasterKeyByRecovery,
            recoveryKeyVerifier: rotatedRecoveryKey.recoveryKeyVerifier,
          }),
        );
        const sentPayload = submitRecoveryKeyReminderConfirmMock.mock.calls[0][0];
        expect(sentPayload).not.toHaveProperty('recoveryKeyDisplay');
        expect(JSON.stringify(sentPayload)).not.toContain(rotatedRecoveryKey.recoveryKeyDisplay);
        expect(await screen.findByText(/recovery key has been confirmed/i)).toBeInTheDocument();
      });

      it('shows an error and never rotates the key when the passphrase is wrong', async () => {
        unwrapMasterKeyByPassphraseMock.mockRejectedValue(new Error('OperationError'));

        render(<SettingsClient />);
        const passphraseInput = await screen.findByLabelText(
          /confirm your encryption passphrase to continue/i,
        );
        fireEvent.change(passphraseInput, { target: { value: 'wrong-passphrase' } });
        fireEvent.click(screen.getByRole('button', { name: /generate a new recovery key/i }));

        expect(await screen.findByText(/incorrect current passphrase/i)).toBeInTheDocument();
        expect(rewrapMasterKeyByNewRecoveryKeyMock).not.toHaveBeenCalled();
      });
    });
  });
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryKeyRevealCard } from './recovery-key-reveal-card';

afterEach(() => {
  cleanup();
});

function renderCard(overrides: Partial<Parameters<typeof RecoveryKeyRevealCard>[0]> = {}) {
  const onContinue = vi.fn();
  const onConfirmedSavedChange = vi.fn();
  render(
    <RecoveryKeyRevealCard
      heading="Test heading"
      description="Test description"
      recoveryKeyDisplay="aaaa-bbbb-cccc-dddd"
      confirmedSaved={false}
      onConfirmedSavedChange={onConfirmedSavedChange}
      busy={false}
      busyLabel="Saving…"
      continueLabel="Continue"
      error={null}
      onContinue={onContinue}
      {...overrides}
    />,
  );
  return { onContinue, onConfirmedSavedChange };
}

describe('RecoveryKeyRevealCard', () => {
  it('shows the recovery key and heading', () => {
    renderCard();
    expect(screen.getByText('aaaa-bbbb-cccc-dddd')).toBeInTheDocument();
    expect(screen.getByText('Test heading')).toBeInTheDocument();
  });

  it('disables the continue button until the checkbox is checked', () => {
    renderCard({ confirmedSaved: false });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('enables the continue button once confirmedSaved is true', () => {
    renderCard({ confirmedSaved: true });
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
  });

  it('calls onConfirmedSavedChange when the checkbox is toggled', () => {
    const { onConfirmedSavedChange } = renderCard();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onConfirmedSavedChange).toHaveBeenCalledWith(true);
  });

  it('calls onContinue when the continue button is clicked while enabled', () => {
    const { onContinue } = renderCard({ confirmedSaved: true });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows the busy label and disables continue while busy, even if confirmed', () => {
    renderCard({ confirmedSaved: true, busy: true });
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
  });

  it('shows an error message when provided', () => {
    renderCard({ error: 'Something went wrong' });
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('triggers a download when "Download as text file" is clicked', () => {
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /download as text file/i }));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });
});

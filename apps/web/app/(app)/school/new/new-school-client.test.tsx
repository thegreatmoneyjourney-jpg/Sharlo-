import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewSchoolClient from './new-school-client';

const {
  fetchMySchoolsMock,
  submitCreateSchoolMock,
  setupSchoolKeyMaterialMock,
  pickSharedDriveMock,
  createSchoolFolderMock,
} = vi.hoisted(() => ({
  fetchMySchoolsMock: vi.fn(),
  submitCreateSchoolMock: vi.fn(),
  setupSchoolKeyMaterialMock: vi.fn(),
  pickSharedDriveMock: vi.fn(),
  createSchoolFolderMock: vi.fn(),
}));

// `RequireMasterKey` has its own dedicated test file — skip straight to
// "unlocked" with a fake key, same pattern `new-exam-client.test.tsx`
// already established for the identical reason.
vi.mock('../../require-master-key', () => ({
  RequireMasterKey: ({ children }: { children: (masterKey: Uint8Array) => React.ReactNode }) =>
    children(new Uint8Array(32)),
}));
vi.mock('@/lib/api/schools-client', () => ({
  fetchMySchools: fetchMySchoolsMock,
  submitCreateSchool: submitCreateSchoolMock,
}));
vi.mock('@/lib/crypto/school-key', () => ({
  setupSchoolKeyMaterial: setupSchoolKeyMaterialMock,
}));
vi.mock('@/lib/drive/shared-drive-picker', () => ({ pickSharedDrive: pickSharedDriveMock }));
vi.mock('@/lib/drive/school-folder', () => ({ createSchoolFolder: createSchoolFolderMock }));

const KEY_MATERIAL = {
  schoolWrappedKeyByAdminMasterKey: 'aabbcc',
  adminX25519PublicKey: 'ddeeff',
  adminX25519WrappedPrivateKey: '001122',
};

beforeEach(() => {
  fetchMySchoolsMock.mockReset().mockResolvedValue([]);
  submitCreateSchoolMock.mockReset().mockResolvedValue({
    id: 'school-1',
    name: 'Riverside Academy',
    driveLocationType: 'folder',
    driveLocationId: 'folder-1',
  });
  setupSchoolKeyMaterialMock.mockReset().mockResolvedValue(KEY_MATERIAL);
  pickSharedDriveMock.mockReset();
  createSchoolFolderMock.mockReset().mockResolvedValue('folder-1');
});

afterEach(() => {
  cleanup();
});

describe('NewSchoolClient', () => {
  it('shows the existing school instead of the form when the admin already has one', async () => {
    fetchMySchoolsMock.mockResolvedValue([
      {
        id: 'school-1',
        name: 'Existing Academy',
        driveLocationType: 'folder',
        driveLocationId: 'f1',
      },
    ]);
    render(<NewSchoolClient />);

    expect(await screen.findByText(/you already manage a school/i)).toBeInTheDocument();
    expect(screen.getByText('Existing Academy')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create school/i })).not.toBeInTheDocument();
  });

  it('shows an error message if checking for an existing school fails', async () => {
    fetchMySchoolsMock.mockRejectedValue(new Error('boom'));
    render(<NewSchoolClient />);

    expect(await screen.findByText(/couldn't check your existing schools/i)).toBeInTheDocument();
  });

  it('disables "Create school" until a name is entered and (for the Workspace path) a Shared Drive is picked', async () => {
    render(<NewSchoolClient />);
    await screen.findByText(/create your school/i);

    const submitButton = screen.getByRole('button', { name: /create school/i });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/school name/i), {
      target: { value: 'Riverside Academy' },
    });
    expect(submitButton).toBeDisabled(); // workspace is the default; still needs a picked drive

    pickSharedDriveMock.mockResolvedValue({ id: 'drive-1', name: 'My School Drive' });
    fireEvent.click(screen.getByRole('button', { name: /select or create a shared drive/i }));
    await screen.findByRole('button', { name: /selected: my school drive/i });

    expect(submitButton).not.toBeDisabled();
  });

  it('creates a school on the Workspace path using the picked Shared Drive id', async () => {
    render(<NewSchoolClient />);
    await screen.findByText(/create your school/i);

    fireEvent.change(screen.getByLabelText(/school name/i), {
      target: { value: 'Riverside Academy' },
    });
    pickSharedDriveMock.mockResolvedValue({ id: 'drive-1', name: 'My School Drive' });
    fireEvent.click(screen.getByRole('button', { name: /select or create a shared drive/i }));
    await screen.findByRole('button', { name: /selected: my school drive/i });

    fireEvent.click(screen.getByRole('button', { name: /create school/i }));

    await waitFor(() =>
      expect(submitCreateSchoolMock).toHaveBeenCalledWith({
        name: 'Riverside Academy',
        driveLocationType: 'shared_drive',
        driveLocationId: 'drive-1',
        ...KEY_MATERIAL,
      }),
    );
    expect(createSchoolFolderMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/school created/i)).toBeInTheDocument();
  });

  it('creates a school on the personal-account path by creating a Drive folder first', async () => {
    render(<NewSchoolClient />);
    await screen.findByText(/create your school/i);

    fireEvent.change(screen.getByLabelText(/school name/i), {
      target: { value: 'Riverside Academy' },
    });
    fireEvent.click(screen.getByLabelText(/i have a personal google account/i));

    const submitButton = screen.getByRole('button', { name: /create school/i });
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    await waitFor(() => expect(createSchoolFolderMock).toHaveBeenCalledWith('Riverside Academy'));
    expect(submitCreateSchoolMock).toHaveBeenCalledWith({
      name: 'Riverside Academy',
      driveLocationType: 'folder',
      driveLocationId: 'folder-1',
      ...KEY_MATERIAL,
    });
    expect(pickSharedDriveMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/school created/i)).toBeInTheDocument();
  });

  it('shows an error and stays on the form if creation fails', async () => {
    submitCreateSchoolMock.mockRejectedValue(new Error('boom'));
    render(<NewSchoolClient />);
    await screen.findByText(/create your school/i);

    fireEvent.change(screen.getByLabelText(/school name/i), {
      target: { value: 'Riverside Academy' },
    });
    fireEvent.click(screen.getByLabelText(/i have a personal google account/i));
    fireEvent.click(screen.getByRole('button', { name: /create school/i }));

    expect(await screen.findByText(/couldn't create your school/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create school/i })).toBeInTheDocument();
  });

  it('shows an error if the Google Picker fails to open, without blocking retry', async () => {
    pickSharedDriveMock.mockRejectedValue(new Error('picker boom'));
    render(<NewSchoolClient />);
    await screen.findByText(/create your school/i);

    fireEvent.click(screen.getByRole('button', { name: /select or create a shared drive/i }));

    expect(await screen.findByText(/couldn't open the google drive picker/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /select or create a shared drive/i }),
    ).not.toBeDisabled();
  });
});

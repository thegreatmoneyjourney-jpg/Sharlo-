import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SchoolDriveAccessBanner from './school-drive-access-banner';

const { fetchMyMembershipMock, submitConfirmDriveAccessMock, pickSchoolContainerMock } = vi.hoisted(
  () => ({
    fetchMyMembershipMock: vi.fn(),
    submitConfirmDriveAccessMock: vi.fn(),
    pickSchoolContainerMock: vi.fn(),
  }),
);

vi.mock('@/lib/api/schools-client', () => ({
  fetchMyMembership: fetchMyMembershipMock,
  submitConfirmDriveAccess: submitConfirmDriveAccessMock,
}));
vi.mock('@/lib/drive/pick-school-container', () => ({
  pickSchoolContainer: pickSchoolContainerMock,
}));

const PENDING_MEMBERSHIP = {
  id: 'member-1',
  schoolId: 'school-1',
  driveLocationType: 'folder' as const,
  driveLocationId: 'folder-abc',
  driveAccessGranted: false,
};

beforeEach(() => {
  fetchMyMembershipMock.mockReset();
  submitConfirmDriveAccessMock.mockReset().mockResolvedValue(undefined);
  pickSchoolContainerMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SchoolDriveAccessBanner', () => {
  it('renders nothing when there is no membership', async () => {
    fetchMyMembershipMock.mockResolvedValue(null);
    const { container } = render(<SchoolDriveAccessBanner />);
    await waitFor(() => expect(fetchMyMembershipMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when Drive access is already granted', async () => {
    fetchMyMembershipMock.mockResolvedValue({ ...PENDING_MEMBERSHIP, driveAccessGranted: true });
    const { container } = render(<SchoolDriveAccessBanner />);
    await waitFor(() => expect(fetchMyMembershipMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing if the membership fetch fails — a soft nudge, not a gate', async () => {
    fetchMyMembershipMock.mockRejectedValue(new Error('401'));
    const { container } = render(<SchoolDriveAccessBanner />);
    await waitFor(() => expect(fetchMyMembershipMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the prompt naming "folder" for a folder-type location', async () => {
    fetchMyMembershipMock.mockResolvedValue(PENDING_MEMBERSHIP);
    render(<SchoolDriveAccessBanner />);
    expect(await screen.findByText(/shared a google drive folder with you/i)).toBeInTheDocument();
  });

  it('shows the prompt naming "Shared Drive" for a shared_drive-type location', async () => {
    fetchMyMembershipMock.mockResolvedValue({
      ...PENDING_MEMBERSHIP,
      driveLocationType: 'shared_drive',
    });
    render(<SchoolDriveAccessBanner />);
    expect(
      await screen.findByText(/shared a google drive shared drive with you/i),
    ).toBeInTheDocument();
  });

  it('confirms Drive access and hides the banner when the correct item is picked', async () => {
    fetchMyMembershipMock.mockResolvedValue(PENDING_MEMBERSHIP);
    pickSchoolContainerMock.mockResolvedValue({ outcome: 'confirmed' });
    render(<SchoolDriveAccessBanner />);
    await screen.findByRole('button', { name: /select the shared folder/i });

    fireEvent.click(screen.getByRole('button', { name: /select the shared folder/i }));

    await waitFor(() => expect(pickSchoolContainerMock).toHaveBeenCalledWith('folder-abc'));
    await waitFor(() => expect(submitConfirmDriveAccessMock).toHaveBeenCalled());
    expect(
      screen.queryByRole('button', { name: /select the shared folder/i }),
    ).not.toBeInTheDocument();
  });

  it('shows a specific error and stays visible when the wrong item is picked', async () => {
    fetchMyMembershipMock.mockResolvedValue(PENDING_MEMBERSHIP);
    pickSchoolContainerMock.mockResolvedValue({ outcome: 'wrong_item', pickedName: 'My Stuff' });
    render(<SchoolDriveAccessBanner />);
    await screen.findByRole('button', { name: /select the shared folder/i });

    fireEvent.click(screen.getByRole('button', { name: /select the shared folder/i }));

    expect(await screen.findByText(/you selected "my stuff"/i)).toBeInTheDocument();
    expect(submitConfirmDriveAccessMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /select the shared folder/i })).toBeInTheDocument();
  });

  it('shows no error and stays visible when the picker is cancelled', async () => {
    fetchMyMembershipMock.mockResolvedValue(PENDING_MEMBERSHIP);
    pickSchoolContainerMock.mockResolvedValue({ outcome: 'cancelled' });
    render(<SchoolDriveAccessBanner />);
    await screen.findByRole('button', { name: /select the shared folder/i });

    fireEvent.click(screen.getByRole('button', { name: /select the shared folder/i }));

    await waitFor(() => expect(pickSchoolContainerMock).toHaveBeenCalled());
    expect(submitConfirmDriveAccessMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /select the shared folder/i })).toBeInTheDocument();
  });

  it('hides the banner for this view when dismissed', async () => {
    fetchMyMembershipMock.mockResolvedValue(PENDING_MEMBERSHIP);
    render(<SchoolDriveAccessBanner />);
    await screen.findByRole('button', { name: /select the shared folder/i });

    fireEvent.click(screen.getByRole('button', { name: /dismiss for now/i }));

    expect(
      screen.queryByRole('button', { name: /select the shared folder/i }),
    ).not.toBeInTheDocument();
  });
});

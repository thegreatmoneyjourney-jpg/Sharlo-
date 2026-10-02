import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SchoolMembersPanel } from './school-members-panel';

const { fetchSchoolMembersMock, submitAddTeacherMock, shareSchoolContainerMock } = vi.hoisted(
  () => ({
    fetchSchoolMembersMock: vi.fn(),
    submitAddTeacherMock: vi.fn(),
    shareSchoolContainerMock: vi.fn(),
  }),
);

vi.mock('@/lib/api/schools-client', () => ({
  fetchSchoolMembers: fetchSchoolMembersMock,
  submitAddTeacher: submitAddTeacherMock,
}));
vi.mock('@/lib/drive/share-school-container', () => ({
  shareSchoolContainer: shareSchoolContainerMock,
}));

const SCHOOL = {
  id: 'school-1',
  name: 'Riverside Academy',
  driveLocationType: 'folder' as const,
  driveLocationId: 'folder-abc',
};

beforeEach(() => {
  fetchSchoolMembersMock.mockReset().mockResolvedValue([]);
  submitAddTeacherMock.mockReset();
  shareSchoolContainerMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('SchoolMembersPanel', () => {
  it('shows "no teachers added yet" when the school has no members', async () => {
    render(<SchoolMembersPanel school={SCHOOL} />);
    expect(await screen.findByText(/no teachers added yet/i)).toBeInTheDocument();
  });

  it('lists existing members with their Drive-access status', async () => {
    fetchSchoolMembersMock.mockResolvedValue([
      { id: 'm1', userId: 'u1', email: 'connected@example.com', driveAccessGranted: true },
      { id: 'm2', userId: 'u2', email: 'pending@example.com', driveAccessGranted: false },
    ]);
    render(<SchoolMembersPanel school={SCHOOL} />);

    expect(await screen.findByText('connected@example.com')).toBeInTheDocument();
    expect(screen.getByText('pending@example.com')).toBeInTheDocument();
    expect(screen.getByText(/^connected$/i)).toBeInTheDocument();
    expect(screen.getByText(/pending drive access/i)).toBeInTheDocument();
  });

  it('adds a teacher, shares the Drive container, and shows them in the list', async () => {
    submitAddTeacherMock.mockResolvedValue({
      outcome: 'added',
      member: { id: 'm3', userId: 'u3', email: 'new@example.com', driveAccessGranted: false },
    });
    render(<SchoolMembersPanel school={SCHOOL} />);
    await screen.findByText(/no teachers added yet/i);

    fireEvent.change(screen.getByLabelText(/add a teacher by email/i), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add teacher/i }));

    await waitFor(() =>
      expect(submitAddTeacherMock).toHaveBeenCalledWith('school-1', 'new@example.com'),
    );
    expect(shareSchoolContainerMock).toHaveBeenCalledWith('folder-abc', 'new@example.com');
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
  });

  it.each([
    ['teacher_not_found', /no sharlo account exists/i],
    ['wrong_auth_provider', /signed up without google/i],
    ['already_member', /already belongs to a school/i],
    ['school_not_found', /couldn't find your school/i],
  ])('shows a specific message for the %s outcome', async (outcome, expectedMessage) => {
    submitAddTeacherMock.mockResolvedValue({ outcome });
    render(<SchoolMembersPanel school={SCHOOL} />);
    await screen.findByText(/no teachers added yet/i);

    fireEvent.change(screen.getByLabelText(/add a teacher by email/i), {
      target: { value: 'someone@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add teacher/i }));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(shareSchoolContainerMock).not.toHaveBeenCalled();
  });

  it('keeps the newly-added member visible and shows a specific error if only the Drive-sharing call fails', async () => {
    submitAddTeacherMock.mockResolvedValue({
      outcome: 'added',
      member: { id: 'm4', userId: 'u4', email: 'new@example.com', driveAccessGranted: false },
    });
    shareSchoolContainerMock.mockRejectedValue(new Error('insufficient scope'));
    render(<SchoolMembersPanel school={SCHOOL} />);
    await screen.findByText(/no teachers added yet/i);

    fireEvent.change(screen.getByLabelText(/add a teacher by email/i), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add teacher/i }));

    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    expect(await screen.findByText(/couldn't share the drive folder/i)).toBeInTheDocument();
  });
});

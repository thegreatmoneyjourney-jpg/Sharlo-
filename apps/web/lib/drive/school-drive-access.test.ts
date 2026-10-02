import { describe, expect, it } from 'vitest';
import { ensureSchoolDriveAccess } from './school-drive-access';
import type { MyMembership } from '../api/schools-client';

const GRANTED_MEMBERSHIP: MyMembership = {
  id: 'member-1',
  schoolId: 'school-1',
  driveLocationType: 'folder',
  driveLocationId: 'folder-abc',
  driveAccessGranted: true,
  adminX25519PublicKey: 'fixture-public-key-not-real',
};

describe('ensureSchoolDriveAccess', () => {
  it('passes when the membership has driveAccessGranted', () => {
    expect(ensureSchoolDriveAccess(GRANTED_MEMBERSHIP)).toEqual({ ok: true });
  });

  it('fails with not_a_school_member when there is no membership at all', () => {
    expect(ensureSchoolDriveAccess(null)).toEqual({
      ok: false,
      reason: 'not_a_school_member',
    });
  });

  it('fails with drive_access_not_granted when the Picker step is not yet completed', () => {
    expect(ensureSchoolDriveAccess({ ...GRANTED_MEMBERSHIP, driveAccessGranted: false })).toEqual({
      ok: false,
      reason: 'drive_access_not_granted',
    });
  });
});

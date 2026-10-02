import { hexToBytes, type Bytes } from '../crypto/encoding';
import { unwrapAdminX25519PrivateKey } from '../crypto/school-key';
import type { X25519KeyPair } from '../crypto/x25519';
import { listSealedRecordsByType } from '../storage/school-container-store';
import {
  unsealExamResultsForSchool,
  SCHOOL_EXAM_RESULTS_SEALED_TYPE,
  type ExamResults,
} from './exam-results';

/**
 * `M3-017`/`FR-SCHOOL-04` — the principal dashboard's one data-fetch
 * function: every exam, from every teacher-under-school, decrypted
 * client-side in the admin's own browser. Deliberately takes the admin's
 * raw key material as parameters rather than a `SchoolSummary` object, so
 * this module (`lib/exams/`) doesn't need to depend on the web API
 * client's own types (`lib/api/schools-client.ts`) just to read a few
 * fields off one.
 *
 * Works because every teacher-under-school writes their `M3-016` sealed
 * copy into the *same* shared container (`driveLocationId`) — there is no
 * per-teacher location to iterate, just one container holding every
 * exam any member teacher has ever finalized. `listSealedRecordsByType`
 * finds them all in one Drive query; each is then opened with the
 * admin's own keypair, the same primitive `M3-016`'s own done-when test
 * already exercises end to end.
 */
export async function loadSchoolWideExamResults(
  masterKey: Bytes,
  driveLocationId: string,
  adminX25519PublicKeyHex: string,
  adminX25519WrappedPrivateKeyHex: string,
): Promise<ExamResults[]> {
  const privateKey = await unwrapAdminX25519PrivateKey(masterKey, adminX25519WrappedPrivateKeyHex);
  const keyPair: X25519KeyPair = { publicKey: hexToBytes(adminX25519PublicKeyHex), privateKey };

  const sealedRecords = await listSealedRecordsByType(
    driveLocationId,
    SCHOOL_EXAM_RESULTS_SEALED_TYPE,
  );
  return Promise.all(sealedRecords.map((record) => unsealExamResultsForSchool(keyPair, record)));
}

import { loadGooglePicker, type PickerResponse } from './google-picker-loader';
import { getDriveAccessToken } from '../api/drive-token-client';

export type PickSchoolContainerResult =
  | { outcome: 'confirmed' }
  | { outcome: 'wrong_item'; pickedName: string }
  | { outcome: 'cancelled' };

/**
 * `M3-015`/`FR-SCHOOL-02` — the teacher's half of `ADR-0010`'s own
 * "Access-grant flow" step 3: shows the Picker scoped to items shared
 * *with* the signed-in account (`setOwnedByMe(false)`, unlike the admin's
 * own Shared-Drive-creation Picker in `shared-drive-picker.ts`), so the
 * one relevant item is easy to find among everything else in the
 * teacher's own Drive.
 *
 * Confirms the teacher picked the *specific* resource their membership
 * names, never just "a plausible-looking folder" — a `drive.file` session
 * grant only covers the exact resource explicitly selected, so picking
 * the wrong item would silently leave the teacher still unable to write
 * to their real school's container; that failure mode must be caught
 * here and reported, not assumed away.
 */
export async function pickSchoolContainer(
  expectedDriveLocationId: string,
): Promise<PickSchoolContainerResult> {
  const pickerApiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;
  if (!pickerApiKey) {
    throw new Error(
      'NEXT_PUBLIC_GOOGLE_PICKER_API_KEY is not configured — cannot show the Google Picker.',
    );
  }

  await loadGooglePicker();
  const accessToken = await getDriveAccessToken();
  const picker = window.google!.picker;

  return new Promise((resolve, reject) => {
    try {
      const view = new picker.DocsView(picker.ViewId.DOCS)
        .setEnableDrives(true)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setOwnedByMe(false);

      const builder = new picker.PickerBuilder()
        .setDeveloperKey(pickerApiKey)
        .setOAuthToken(accessToken)
        .addView(view)
        .setCallback((data: PickerResponse) => {
          if (data.action === picker.Action.PICKED) {
            const doc = data.docs?.[0];
            if (doc && doc.id === expectedDriveLocationId) {
              resolve({ outcome: 'confirmed' });
            } else {
              resolve({ outcome: 'wrong_item', pickedName: doc?.name ?? 'that item' });
            }
          } else if (data.action === picker.Action.CANCEL) {
            resolve({ outcome: 'cancelled' });
          }
        });

      builder.build().setVisible(true);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

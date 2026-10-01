import { loadGooglePicker, type PickerResponse } from './google-picker-loader';
import { getDriveAccessToken } from '../api/drive-token-client';

/**
 * `M3-014`/`ADR-0010` — lets a Workspace admin select an *existing*
 * Shared Drive (one they created themselves through Google's own UI,
 * outside this app) rather than this app creating one via the Drive
 * API's `drives.create` method. That method requires the full
 * `https://www.googleapis.com/auth/drive` scope, not `drive.file` — a
 * real, documented Google API constraint found while checking ADR-0010's
 * literal "the app creates a Shared Drive" flow description against
 * this project's drive.file-only non-negotiable
 * (`google-oauth.ts`'s `GOOGLE_OAUTH_SCOPE`, CI-guarded by `M3-011` —
 * never weaken that check, including to make this feature easier).
 *
 * The Picker is Google's own documented mechanism for exactly this
 * shape of problem: `drive.file` only grants access to resources an app
 * created itself, *unless* the user explicitly selects one through the
 * Picker, which grants that specific resource to the app even though it
 * didn't create it. `ADR-0010`'s own access-grant-flow section already
 * establishes this for the *teacher*-joining-a-school step; this reuses
 * the identical mechanism one level earlier, for the *admin*
 * selecting/creating the Shared Drive itself — a deliberate deviation
 * from the ADR's literal "the app creates a Shared Drive for the
 * school" wording, documented here and in the ADR-0010 addendum this
 * task adds, not silently diverged from.
 *
 * **Not verified against Google's real Picker service** — this project
 * has no real Google Cloud Console project/API key configured anywhere
 * yet (sandbox or CI), the same category of gap `M1-011`/`M3-001`/`M3-006`
 * already carry for other Google-integration surfaces this sandbox's
 * network access can't reach. Written to the best of this session's
 * knowledge of the Picker API's documented surface; treat as unproven
 * until exercised against a real account, not already-confirmed working.
 */

export interface PickedSharedDrive {
  id: string;
  name: string;
}

/**
 * Shows the Picker scoped to Shared Drives the signed-in Google account
 * can already see. Resolves with the one the admin selects, or `null` if
 * they cancel without picking one.
 */
export async function pickSharedDrive(): Promise<PickedSharedDrive | null> {
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
        .setIncludeFolders(true);

      const builder = new picker.PickerBuilder()
        .setDeveloperKey(pickerApiKey)
        .setOAuthToken(accessToken)
        .addView(view)
        .setCallback((data: PickerResponse) => {
          if (data.action === picker.Action.PICKED) {
            const doc = data.docs?.[0];
            resolve(doc ? { id: doc.id, name: doc.name } : null);
          } else if (data.action === picker.Action.CANCEL) {
            resolve(null);
          }
        });

      builder.build().setVisible(true);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

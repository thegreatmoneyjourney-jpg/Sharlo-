import RecoveryKeyReminderBanner from './recovery-key-reminder-banner';
import LocalOnlyWarningBanner from './local-only-warning-banner';
import SchoolDriveAccessBanner from './school-drive-access-banner';

/**
 * `M3-004`/`M3-005`/`M3-015` — the first shared layout for the `(app)`
 * route group. Its job is the account-wide banners (Recovery Key
 * reminder, FR-AUTH-09; local-only data-loss warning, FR-AUTH-06; the
 * School-plan Drive-access-grant prompt, FR-SCHOOL-02), so every
 * authenticated page shows all three, not just one specific page.
 * Deliberately minimal — a full nav/header/sidebar shell is a separate,
 * larger piece of work this doesn't need and shouldn't invent
 * speculatively.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LocalOnlyWarningBanner />
      <RecoveryKeyReminderBanner />
      <SchoolDriveAccessBanner />
      {children}
    </>
  );
}

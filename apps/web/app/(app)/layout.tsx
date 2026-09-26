import RecoveryKeyReminderBanner from './recovery-key-reminder-banner';
import LocalOnlyWarningBanner from './local-only-warning-banner';

/**
 * `M3-004`/`M3-005` — the first shared layout for the `(app)` route
 * group. Its job is the two account-wide banners (Recovery Key reminder,
 * FR-AUTH-09; local-only data-loss warning, FR-AUTH-06), so every
 * authenticated page shows both, not just `/settings`. Deliberately
 * minimal — a full nav/header/sidebar shell is a separate, larger piece
 * of work this doesn't need and shouldn't invent speculatively.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LocalOnlyWarningBanner />
      <RecoveryKeyReminderBanner />
      {children}
    </>
  );
}

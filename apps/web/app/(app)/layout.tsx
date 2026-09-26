import RecoveryKeyReminderBanner from './recovery-key-reminder-banner';

/**
 * `M3-004` — the first shared layout for the `(app)` route group. Its only
 * job today is the Recovery Key reminder banner (FR-AUTH-09), so every
 * authenticated page shows it, not just `/settings`. Deliberately minimal
 * — a full nav/header/sidebar shell is a separate, larger piece of work
 * this task doesn't need and shouldn't invent speculatively.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RecoveryKeyReminderBanner />
      {children}
    </>
  );
}

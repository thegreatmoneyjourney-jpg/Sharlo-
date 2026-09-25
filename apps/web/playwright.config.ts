import { defineConfig, devices } from '@playwright/test';

/**
 * Config for the detection-engine test harness (M1-010) only — this repo
 * has no other real-browser Playwright suite. Deliberately scoped to
 * `tests/detection-harness/` and a distinct `.pw-spec.ts` suffix rather
 * than Playwright's own default `**\/*.spec.ts` matcher: `vitest.config.mts`
 * has no custom `include`, so it falls back to Vitest's own default glob,
 * which also matches `*.spec.ts` — colliding on a shared name would mean
 * Vitest tries to collect this file too (importing `@playwright/test`
 * inside a jsdom run, registering zero real Vitest tests). Separate
 * suffixes rather than touching Vitest's config keeps the two suites'
 * default include patterns from ever needing to know about each other.
 */
const PORT = 4174;

export default defineConfig({
  testDir: './tests/detection-harness',
  testMatch: '**/*.pw-spec.ts',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Deliberately 0, including in CI — CLAUDE.md's standing CI rule treats
  // an intermittent failure as something to root-cause, never to retry
  // past. An automatic retry here would silently do exactly what that
  // rule forbids.
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: 'node scripts/serve-detection-harness.mjs',
    url: `http://localhost:${PORT}/harness.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { DETECTION_HARNESS_PORT: String(PORT) },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

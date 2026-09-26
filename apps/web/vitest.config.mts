import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // `lib/crypto/`'s tests run the *real* Argon2id KDF (MODERATE tier,
    // deliberately not mocked — see argon2id.ts's own doc comment), and
    // some individual tests chain several sequential KDF calls (setup,
    // unwrap, rewrap, re-unwrap). Each call alone comfortably fits well
    // under vitest's 5000ms default, but 3-4 chained in one `it()` can
    // occasionally exceed it under momentary sandbox CPU contention — a
    // real timing margin issue, not a hang or a logic bug (a genuine hang
    // would still be caught well before this ceiling).
    testTimeout: 20000,
  },
});

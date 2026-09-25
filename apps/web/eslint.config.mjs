import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Generated vendor asset (scripts/copy-opencv-asset.mjs) — third-party
    // minified code, not ours to lint.
    'public/vendor/**',
    // Generated detection-harness bundle/vendor copy
    // (scripts/build-detection-harness.mjs) — same reasoning as
    // public/vendor/** above.
    'tests/detection-harness/.generated/**',
  ]),
]);

export default eslintConfig;

// @ts-check
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default defineConfig([
  globalIgnores(['dist/**', 'node_modules/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // `no-undef` from `js.configs.recommended` above is disabled for
    // `.ts` files by `tseslint.configs.recommended` (the type checker
    // already covers it there), but a plain `.mjs` script gets no such
    // exemption — flat config has no auto-detected "Node environment"
    // the way legacy `.eslintrc`'s `env: { node: true }` did, so a
    // script using Node's own globals needs them listed explicitly.
    // `scripts/check-oauth-scope.mjs` (M3-011) is the first plain script
    // in this workspace; widen this list if a future one needs more.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
]);

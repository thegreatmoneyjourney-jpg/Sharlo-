import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PACKAGES, findForbiddenDependencies } from './check-no-decrypt-in-backend.mjs';

describe('check-no-decrypt-in-backend', () => {
  it('finds nothing in a package.json with no forbidden dependencies', () => {
    expect(
      findForbiddenDependencies({ dependencies: { fastify: '^5.0.0' }, devDependencies: {} }),
    ).toEqual([]);
  });

  it('detects a forbidden package declared under dependencies', () => {
    expect(
      findForbiddenDependencies({
        dependencies: { 'libsodium-wrappers-sumo': '^0.8.4' },
        devDependencies: {},
      }),
    ).toEqual(['libsodium-wrappers-sumo']);
  });

  it('detects a forbidden package declared under devDependencies too', () => {
    expect(
      findForbiddenDependencies({
        dependencies: {},
        devDependencies: { 'libsodium-wrappers': '^0.7.15' },
      }),
    ).toEqual(['libsodium-wrappers']);
  });

  it('handles a package.json with no dependencies/devDependencies fields at all', () => {
    expect(findForbiddenDependencies({})).toEqual([]);
  });

  it('matches the real, currently-committed apps/api/package.json (the guard this script exists to run in CI)', () => {
    const realPackageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(findForbiddenDependencies(realPackageJson)).toEqual([]);
  });

  it('lists every libsodium package variant as forbidden, not just the Argon2id-capable one', () => {
    expect(FORBIDDEN_PACKAGES).toEqual(
      expect.arrayContaining(['libsodium-wrappers-sumo', 'libsodium-wrappers']),
    );
  });
});

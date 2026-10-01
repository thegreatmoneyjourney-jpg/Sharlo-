import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetMasterKeySessionForTests,
  clearCachedMasterKey,
  getCachedMasterKey,
  setCachedMasterKey,
} from './master-key-session';

afterEach(() => {
  _resetMasterKeySessionForTests();
});

describe('master-key-session', () => {
  it('has no cached key initially', () => {
    expect(getCachedMasterKey()).toBeNull();
  });

  it('returns whatever was cached', () => {
    const key = new Uint8Array(32);
    setCachedMasterKey(key);
    expect(getCachedMasterKey()).toBe(key);
  });

  it('clears the cached key', () => {
    setCachedMasterKey(new Uint8Array(32));
    clearCachedMasterKey();
    expect(getCachedMasterKey()).toBeNull();
  });
});

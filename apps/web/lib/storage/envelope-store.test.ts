import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchAccountInfoMock } = vi.hoisted(() => ({ fetchAccountInfoMock: vi.fn() }));

vi.mock('../api/account-client', () => ({ fetchAccountInfo: fetchAccountInfoMock }));

import * as driveEnvelopeStore from './drive-envelope-store';
import * as localEnvelopeStore from './local-envelope-store';
import { _resetEnvelopeStoreCacheForTests, getEnvelopeStore } from './envelope-store';

beforeEach(() => {
  fetchAccountInfoMock.mockReset();
  _resetEnvelopeStoreCacheForTests();
});

afterEach(() => {
  _resetEnvelopeStoreCacheForTests();
});

describe('getEnvelopeStore', () => {
  it('returns the local (IndexedDB) store for a local-only account', async () => {
    fetchAccountInfoMock.mockResolvedValue({ authMode: 'local_only' });
    const store = await getEnvelopeStore();
    expect(store).toBe(localEnvelopeStore);
  });

  it('returns the Drive store for a Google account', async () => {
    fetchAccountInfoMock.mockResolvedValue({ authMode: 'google' });
    const store = await getEnvelopeStore();
    expect(store).toBe(driveEnvelopeStore);
  });

  it('caches the resolved authMode — a second call does not re-fetch', async () => {
    fetchAccountInfoMock.mockResolvedValue({ authMode: 'google' });

    await getEnvelopeStore();
    await getEnvelopeStore();

    expect(fetchAccountInfoMock).toHaveBeenCalledTimes(1);
  });
});

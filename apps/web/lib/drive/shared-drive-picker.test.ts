import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickerResponse } from './google-picker-loader';
import { pickSharedDrive } from './shared-drive-picker';

vi.mock('./google-picker-loader', () => ({ loadGooglePicker: vi.fn(async () => undefined) }));
vi.mock('../api/drive-token-client', () => ({
  getDriveAccessToken: vi.fn(async () => 'test-access-token'),
}));

const ORIGINAL_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;

function installFakeGooglePicker() {
  let capturedCallback: ((data: PickerResponse) => void) | undefined;
  const view = {
    setEnableDrives: vi.fn().mockReturnThis(),
    setSelectFolderEnabled: vi.fn().mockReturnThis(),
    setIncludeFolders: vi.fn().mockReturnThis(),
  };
  const builder = {
    setDeveloperKey: vi.fn().mockReturnThis(),
    setOAuthToken: vi.fn().mockReturnThis(),
    addView: vi.fn().mockReturnThis(),
    setCallback: vi.fn((cb: (data: PickerResponse) => void) => {
      capturedCallback = cb;
      return builder;
    }),
    build: vi.fn(() => ({ setVisible: vi.fn() })),
  };
  // Plain `function` constructors, not `vi.fn(() => ...)` — an arrow
  // function can't back a `new` call (arrows are never constructible,
  // the exact `"... is not a constructor"` TypeError this fixture hit
  // before this fix), so these are real constructor functions that
  // happen to override their return value, a valid JS pattern `new`
  // respects for object (non-primitive) returns.
  function DocsView(this: unknown) {
    return view;
  }
  function PickerBuilder(this: unknown) {
    return builder;
  }
  window.google = {
    picker: {
      DocsView: DocsView as unknown as new (viewId: string) => typeof view,
      PickerBuilder: PickerBuilder as unknown as new () => typeof builder,
      ViewId: { DOCS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
    },
  };
  return {
    fireCallback: (data: PickerResponse) => capturedCallback!(data),
    builder,
    view,
  };
}

// `pickSharedDrive` awaits `loadGooglePicker()` then `getDriveAccessToken()`
// before it ever calls `setCallback` — firing the fake callback right after
// calling `pickSharedDrive()` would race ahead of those microtasks. A few
// `Promise.resolve()` ticks reliably drains them (both mocks resolve in a
// single microtask each) without hardcoding an exact hop count.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY = 'test-picker-api-key';
});

afterEach(() => {
  process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY = ORIGINAL_API_KEY;
  delete window.google;
  vi.clearAllMocks();
});

describe('pickSharedDrive', () => {
  it('throws if NEXT_PUBLIC_GOOGLE_PICKER_API_KEY is not configured', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;

    await expect(pickSharedDrive()).rejects.toThrow(/NEXT_PUBLIC_GOOGLE_PICKER_API_KEY/);
  });

  it('resolves with the picked Shared Drive when the user selects one', async () => {
    const fake = installFakeGooglePicker();

    const resultPromise = pickSharedDrive();
    await flushMicrotasks();
    fake.fireCallback({ action: 'picked', docs: [{ id: 'drive-1', name: 'My School Drive' }] });

    expect(await resultPromise).toEqual({ id: 'drive-1', name: 'My School Drive' });
    expect(fake.builder.setOAuthToken).toHaveBeenCalledWith('test-access-token');
    expect(fake.builder.setDeveloperKey).toHaveBeenCalledWith('test-picker-api-key');
    expect(fake.view.setEnableDrives).toHaveBeenCalledWith(true);
  });

  it('resolves with null when the user cancels', async () => {
    const fake = installFakeGooglePicker();

    const resultPromise = pickSharedDrive();
    await flushMicrotasks();
    fake.fireCallback({ action: 'cancel' });

    expect(await resultPromise).toBeNull();
  });
});

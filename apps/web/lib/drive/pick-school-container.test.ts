import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickerResponse } from './google-picker-loader';
import { pickSchoolContainer } from './pick-school-container';

vi.mock('./google-picker-loader', () => ({ loadGooglePicker: vi.fn(async () => undefined) }));
vi.mock('../api/drive-token-client', () => ({
  getDriveAccessToken: vi.fn(async () => 'test-access-token'),
}));

const ORIGINAL_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;

// Same fixture shape as `shared-drive-picker.test.ts` — see that file's own
// comments for why these are plain `function` constructors (not
// `vi.fn(() => ...)`, which can't back a `new` call) and why firing the
// captured callback needs a `flushMicrotasks()` delay first.
function installFakeGooglePicker() {
  let capturedCallback: ((data: PickerResponse) => void) | undefined;
  const view = {
    setEnableDrives: vi.fn().mockReturnThis(),
    setSelectFolderEnabled: vi.fn().mockReturnThis(),
    setIncludeFolders: vi.fn().mockReturnThis(),
    setOwnedByMe: vi.fn().mockReturnThis(),
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

describe('pickSchoolContainer', () => {
  it('throws if NEXT_PUBLIC_GOOGLE_PICKER_API_KEY is not configured', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;

    await expect(pickSchoolContainer('drive-1')).rejects.toThrow(
      /NEXT_PUBLIC_GOOGLE_PICKER_API_KEY/,
    );
  });

  it('scopes the view to items not owned by the viewer', async () => {
    const fake = installFakeGooglePicker();

    const resultPromise = pickSchoolContainer('drive-1');
    await flushMicrotasks();
    fake.fireCallback({ action: 'picked', docs: [{ id: 'drive-1', name: 'Shared Folder' }] });
    await resultPromise;

    expect(fake.view.setOwnedByMe).toHaveBeenCalledWith(false);
  });

  it('resolves "confirmed" when the picked item matches the expected id', async () => {
    const fake = installFakeGooglePicker();

    const resultPromise = pickSchoolContainer('drive-1');
    await flushMicrotasks();
    fake.fireCallback({ action: 'picked', docs: [{ id: 'drive-1', name: 'Shared Folder' }] });

    expect(await resultPromise).toEqual({ outcome: 'confirmed' });
  });

  it('resolves "wrong_item" when the picked item does not match the expected id', async () => {
    const fake = installFakeGooglePicker();

    const resultPromise = pickSchoolContainer('drive-1');
    await flushMicrotasks();
    fake.fireCallback({ action: 'picked', docs: [{ id: 'some-other-drive', name: 'My Stuff' }] });

    expect(await resultPromise).toEqual({ outcome: 'wrong_item', pickedName: 'My Stuff' });
  });

  it('resolves "cancelled" when the user cancels without picking anything', async () => {
    const fake = installFakeGooglePicker();

    const resultPromise = pickSchoolContainer('drive-1');
    await flushMicrotasks();
    fake.fireCallback({ action: 'cancel' });

    expect(await resultPromise).toEqual({ outcome: 'cancelled' });
  });
});

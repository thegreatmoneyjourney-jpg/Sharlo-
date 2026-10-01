/**
 * `M3-014`/`ADR-0010` — lazy-loads Google's Picker API
 * (`https://apis.google.com/js/api.js` + `gapi.load('picker', ...)`), a
 * `<script>`-tag load, the same category of "not a normal npm/ESM
 * package" workaround `scanning/opencv-loader.ts` already established,
 * for the same underlying reason: Google serves this from its own CDN
 * by design, not as a bundler-friendly package — there is no official
 * way to `import` it. `shared-drive-picker.ts` is the actual Picker
 * usage; this module only gets it loaded and available at
 * `window.google.picker`.
 *
 * Minimal, local type declarations for just the surface this task
 * actually uses — not a full `@types/google.picker` dependency for one
 * narrowly-scoped global this sandbox can't verify against a real
 * Google Cloud Console project anyway (see `shared-drive-picker.ts`'s
 * own doc comment for that caveat in full).
 */

export interface PickerDocument {
  id: string;
  name: string;
}

export interface PickerResponse {
  action: string;
  docs?: PickerDocument[];
}

interface PickerView {
  setEnableDrives(enabled: boolean): PickerView;
  setSelectFolderEnabled(enabled: boolean): PickerView;
  setIncludeFolders(include: boolean): PickerView;
}

interface Picker {
  setVisible(visible: boolean): void;
}

interface PickerBuilder {
  setDeveloperKey(key: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  addView(view: PickerView): PickerBuilder;
  setCallback(callback: (data: PickerResponse) => void): PickerBuilder;
  build(): Picker;
}

interface GooglePickerNamespace {
  DocsView: new (viewId: string) => PickerView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: string };
  Action: { PICKED: string; CANCEL: string };
}

interface GapiGlobal {
  load(api: string, callback: () => void): void;
}

declare global {
  interface Window {
    gapi?: GapiGlobal;
    google?: { picker: GooglePickerNamespace };
  }
}

const PICKER_SCRIPT_URL = 'https://apis.google.com/js/api.js';

let loadPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

/** Resolves once `gapi.load('picker', ...)` has completed — after this, `window.google.picker` is available. */
export async function loadGooglePicker(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      await loadScript(PICKER_SCRIPT_URL);
      await new Promise<void>((resolve) => {
        window.gapi!.load('picker', () => resolve());
      });
    })();
  }
  return loadPromise;
}

/** Test-only: reset the module-level cache between test cases. */
export function _resetGooglePickerLoaderForTests(): void {
  loadPromise = null;
}

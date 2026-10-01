import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetGooglePickerLoaderForTests, loadGooglePicker } from './google-picker-loader';

beforeEach(() => {
  _resetGooglePickerLoaderForTests();
});

afterEach(() => {
  delete window.gapi;
  document.querySelectorAll('script').forEach((script) => script.remove());
});

describe('loadGooglePicker', () => {
  it('appends the Picker script tag and calls gapi.load("picker", ...) once the script loads', async () => {
    const loadMock = vi.fn((_api: string, callback: () => void) => callback());
    // Script tags appended via document.head.appendChild don't actually
    // fetch/execute in jsdom — simulate the load by assigning `gapi`
    // ourselves and firing the script's own onload handler, same as a
    // real browser would once apis.google.com/js/api.js finished loading.
    const appendChildSpy = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation((node: Node) => {
        const script = node as HTMLScriptElement;
        window.gapi = { load: loadMock };
        queueMicrotask(() => script.onload?.(new Event('load')));
        return node;
      });

    await loadGooglePicker();

    expect(appendChildSpy).toHaveBeenCalledTimes(1);
    const scriptEl = appendChildSpy.mock.calls[0]![0] as HTMLScriptElement;
    expect(scriptEl.src).toBe('https://apis.google.com/js/api.js');
    expect(loadMock).toHaveBeenCalledWith('picker', expect.any(Function));

    appendChildSpy.mockRestore();
  });

  it('only loads the script once across multiple calls (module-level cache)', async () => {
    const loadMock = vi.fn((_api: string, callback: () => void) => callback());
    const appendChildSpy = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation((node: Node) => {
        const script = node as HTMLScriptElement;
        window.gapi = { load: loadMock };
        queueMicrotask(() => script.onload?.(new Event('load')));
        return node;
      });

    await loadGooglePicker();
    await loadGooglePicker();

    expect(appendChildSpy).toHaveBeenCalledTimes(1);
    appendChildSpy.mockRestore();
  });

  it('rejects if the script fails to load', async () => {
    const appendChildSpy = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation((node: Node) => {
        const script = node as HTMLScriptElement;
        queueMicrotask(() => script.onerror?.(new Event('error')));
        return node;
      });

    await expect(loadGooglePicker()).rejects.toThrow(/Failed to load script/);
    appendChildSpy.mockRestore();
  });
});

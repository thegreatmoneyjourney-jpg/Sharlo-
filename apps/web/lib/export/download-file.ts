/**
 * Triggers a browser download of an in-memory `Blob` — the standard
 * object-URL + temporary-anchor-click pattern, with no server involved
 * (the file is built entirely from already-decrypted local data). The
 * object URL is revoked right after the click dispatches; the browser
 * has already queued the download by then.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

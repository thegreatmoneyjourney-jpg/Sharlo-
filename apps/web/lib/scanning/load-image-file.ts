/**
 * Loads a batch-imported image `File` (M2-009 — a scanner or gallery
 * photo of a filled-in bubble sheet, picked from a file input rather than
 * captured live from the camera) into pixel data for `read-sheet-from-
 * image.ts`'s `detectAndReadSheet`, downscaling large photos first.
 *
 * Deliberately a separate loader from `app/(app)/templates/custom/
 * image-loading.ts`'s `loadImageFile` (M2-003), not a shared one, despite
 * the near-identical shape: that loader's 1600px cap was tuned for
 * `detect-sheet-boundary.ts`/`detect-bubble-grid.ts`'s contour/
 * HoughCircles-based *template creation* detection (see that file's own
 * doc comment), a different algorithm from the ArUco-marker detection +
 * fixed-geometry bubble classification this one feeds. That read
 * pipeline has only ever been exercised at the resolution live capture
 * actually produces — `camera.ts` requests an ideal 1920x1080 feed — and
 * M2-004's dewarpedDestRect investigation (docs/reports/
 * SHARLO-M2-004.md) found real bubble-sampling precision loss from
 * under-resolving a dewarped sheet. Reusing M2-003's lower cap here would
 * risk that same class of bug for a pipeline never validated at it;
 * matching live capture's own target resolution instead keeps batch
 * import inside the range the read pipeline is actually proven at.
 *
 * Returns a `data:` URL (from `canvas.toDataURL`), not the original
 * blob's object URL — so the pixels handed to detection and any
 * on-screen thumbnail (e.g. batch-import failure reporting) are
 * guaranteed the same resolution, and so there's no `URL.revokeObjectURL`
 * cleanup for a caller to remember.
 */

const MAX_DIMENSION_PX = 1920;

export interface LoadedImageFile {
  imageUrl: string;
  width: number;
  height: number;
  imageData: ImageData;
}

export function loadImageFile(file: File): Promise<LoadedImageFile> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D canvas context unavailable');

        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const imageUrl = canvas.toDataURL('image/jpeg', 0.92);
        resolve({ imageUrl, width, height, imageData });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Could not process image file'));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image file'));
    };
    img.src = objectUrl;
  });
}

/**
 * Loads a user-selected image `File` into pixel data usable by the
 * detection pipeline, downscaling large photos first. A modern phone
 * photo can be 3000-4000px on a side — far more resolution than either
 * `detectSheetBoundary`/`detect-bubble-grid`'s self-scaling parameters
 * were verified against (a few hundred px, see `docs/reports/
 * SHARLO-M2-003.md`) or the on-screen corner-adjust overlay needs, so
 * this resizes once up front rather than processing/rendering at full
 * resolution.
 *
 * Returns a `data:` URL (from `canvas.toDataURL`), not the original
 * blob's object URL — deliberately: the *displayed* image and the
 * `imageData` pixels handed to detection/dewarp must be the exact same
 * resolution, or corner coordinates computed against one would be wrong
 * against the other. A `data:` URL also needs no `URL.revokeObjectURL`
 * cleanup, unlike an object URL.
 */

const MAX_DIMENSION_PX = 1600;

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

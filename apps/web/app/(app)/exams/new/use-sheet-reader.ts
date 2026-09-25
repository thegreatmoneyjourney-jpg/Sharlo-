'use client';

import { useEffect, useState } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';
import { readSheetFromCorners } from '@/lib/scanning/read-sheet-from-image';
import type { SheetReadOutcome } from '@/lib/scanning/read-sheet-from-image';
import type { TemplateGeometry } from '@/lib/templates/geometry';
import type { CapturedFrame } from '../../scan/capture-video-frame';

export type { ReviewCropItem, SheetReadOutcome } from '@/lib/scanning/read-sheet-from-image';

/**
 * Runs the M2-004 read pipeline against a newly captured frame, for a
 * known `geometry` — the "template geometry reader"
 * `bubble-fill.ts`/`roll-number.ts` deferred to this task. Same
 * `useEffect`-keyed-on-a-new-capture shape as `use-dewarp.ts` (a
 * discrete event, not a hot per-frame loop), extended one step further:
 * where `use-dewarp.ts` stops at a displayable dewarped preview, this
 * also runs the actual bubble-reading pass, since both `capture-key`
 * and `scan-students` steps need the same classified-questions output,
 * just interpreted differently by the caller (recorded as the key, or
 * scored against it).
 *
 * The actual dewarp -> map -> read -> M2-006 review-crops logic lives in
 * `lib/scanning/read-sheet-from-image.ts`'s `readSheetFromCorners` — a
 * plain function, not a hook, so M2-009's batch import can call the
 * exact same code path for an uploaded image/PDF page (which has no
 * live per-frame detection loop to have already found its corners, so
 * it calls that module's `detectAndReadSheet` instead, which detects
 * first and then hands off to the identical `readSheetFromCorners`).
 * This hook is only the React-lifecycle wiring around it — a captured
 * frame here already carries `corners` from the live detection loop, so
 * there's never a re-detection step in this path.
 */
export function useSheetReader(
  capturedFrame: CapturedFrame | null,
  geometry: TemplateGeometry | null,
): SheetReadOutcome | null {
  const [outcome, setOutcome] = useState<SheetReadOutcome | null>(null);

  useEffect(() => {
    if (!capturedFrame || !geometry) return;
    let cancelled = false;

    loadOpenCv().then(({ cv }) => {
      if (cancelled) return;
      const result = readSheetFromCorners(
        cv,
        capturedFrame.imageData,
        capturedFrame.corners,
        geometry,
      );
      if (result && !cancelled) setOutcome(result);
    });

    return () => {
      cancelled = true;
    };
  }, [capturedFrame, geometry]);

  return capturedFrame ? outcome : null;
}

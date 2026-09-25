'use client';

import { useEffect, useRef, useState } from 'react';
import { loadOpenCv } from '@/lib/scanning/opencv-loader';
import type { CornerName, CvMat, DetectedCorner, Point } from '@/lib/scanning/corner-markers';
import type { PerspectiveCv } from '@/lib/scanning/perspective-transform';
import { dewarpFrame } from '@/lib/scanning/perspective-transform';
import type { SheetBoundaryCv } from '@/lib/templates/detect-sheet-boundary';
import { detectSheetBoundary } from '@/lib/templates/detect-sheet-boundary';
import type { DetectBubbleGridCv } from '@/lib/templates/detect-bubble-grid';
import { estimateBubbleGrid } from '@/lib/templates/detect-bubble-grid';
import {
  TemplateLayoutTooDenseError,
  computeCustomTemplateGeometry,
} from '@/lib/templates/geometry';
import { generateTemplatePdf } from '@/lib/templates/generate-pdf';
import { loadImageFile } from './image-loading';

export type BuilderStep =
  | { name: 'upload' }
  | { name: 'processing' }
  | {
      name: 'adjust-corners';
      imageUrl: string;
      naturalWidth: number;
      naturalHeight: number;
      corners: Record<CornerName, Point>;
      detectionMethod: 'polygon' | 'bounding-rectangle' | 'default';
    }
  | {
      name: 'adjust-grid';
      imageUrl: string;
      naturalWidth: number;
      naturalHeight: number;
      corners: Record<CornerName, Point>;
      questionCount: number;
      optionsPerQuestion: number;
      gridConfident: boolean;
      generationError?: string;
    }
  | { name: 'preview'; pdfUrl: string; questionCount: number; optionsPerQuestion: number }
  | { name: 'error'; message: string };

export interface UseCustomTemplateBuilderResult {
  step: BuilderStep;
  loadFile: (file: File) => void;
  updateCorners: (corners: Record<CornerName, Point>) => void;
  confirmCorners: () => void;
  updateGrid: (questionCount: number, optionsPerQuestion: number) => void;
  confirmGrid: () => void;
  reset: () => void;
}

const CORNER_INSET_FRACTION = 0.05;

function defaultCorners(width: number, height: number): Record<CornerName, Point> {
  const marginX = width * CORNER_INSET_FRACTION;
  const marginY = height * CORNER_INSET_FRACTION;
  return {
    topLeft: { x: marginX, y: marginY },
    topRight: { x: width - marginX, y: marginY },
    bottomRight: { x: width - marginX, y: height - marginY },
    bottomLeft: { x: marginX, y: height - marginY },
  };
}

function toDetectedCorners(corners: Record<CornerName, Point>): Record<CornerName, DetectedCorner> {
  return Object.fromEntries(
    Object.entries(corners).map(([name, center]) => [
      name,
      { name: name as CornerName, center, markerCorners: [center, center, center, center] },
    ]),
  ) as Record<CornerName, DetectedCorner>;
}

const GENERIC_ANALYZE_ERROR =
  'Couldn’t analyze that photo. Try a clearer, well-lit photo with the sheet on a plain, contrasting background.';

/**
 * Orchestrates the whole custom-template creation flow (M2-003,
 * FR-TPL-02) as a step state machine: upload -> detect the sheet's
 * boundary (`detect-sheet-boundary.ts`) -> the teacher reviews/drags the
 * 4 corners -> dewarp + estimate the bubble grid
 * (`detect-bubble-grid.ts`) -> the teacher reviews/adjusts the question
 * count and options-per-question -> generate a real, printable,
 * ArUco-marked PDF (`generate-pdf.ts` + `computeCustomTemplateGeometry`).
 *
 * Every automatic step (boundary detection, grid estimation) is
 * immediately followed by a review step the teacher can override before
 * anything is generated — per FR-TPL-02's acceptance criteria and this
 * module's own components' file-level doc comments, neither detection
 * step is presented as a confident final answer.
 *
 * **Deliberately stops at a downloadable PDF, not a saved template.**
 * Persisting a custom template needs `owner_id` — a real authenticated
 * user — and M3 (accounts/auth) doesn't exist yet in this codebase. The
 * "Save to my templates" action in the UI is visibly present but
 * disabled with an explanatory label rather than either being hidden
 * (which would make the flow look incomplete for no visible reason) or
 * faked (which would silently lose the teacher's work). See
 * docs/reports/SHARLO-M2-003.md's Flags section.
 */
export function useCustomTemplateBuilder(): UseCustomTemplateBuilderResult {
  const [step, setStep] = useState<BuilderStep>({ name: 'upload' });
  const sourceImageDataRef = useRef<ImageData | null>(null);
  const pdfUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  function loadFile(file: File): void {
    setStep({ name: 'processing' });
    void (async () => {
      try {
        const { imageUrl, width, height, imageData } = await loadImageFile(file);
        sourceImageDataRef.current = imageData;

        const { cv } = await loadOpenCv();
        const perspectiveCv = cv as unknown as PerspectiveCv;
        const mat = perspectiveCv.matFromImageData(imageData) as CvMat & {
          rows: number;
          cols: number;
        };
        let detected;
        try {
          detected = detectSheetBoundary(cv as unknown as SheetBoundaryCv, mat);
        } finally {
          mat.delete();
        }

        setStep({
          name: 'adjust-corners',
          imageUrl,
          naturalWidth: width,
          naturalHeight: height,
          corners: detected ? detected.corners : defaultCorners(width, height),
          detectionMethod: detected ? detected.method : 'default',
        });
      } catch {
        setStep({ name: 'error', message: GENERIC_ANALYZE_ERROR });
      }
    })();
  }

  function updateCorners(corners: Record<CornerName, Point>): void {
    setStep((prev) => (prev.name === 'adjust-corners' ? { ...prev, corners } : prev));
  }

  function confirmCorners(): void {
    if (step.name !== 'adjust-corners') return;
    const { imageUrl, naturalWidth, naturalHeight, corners } = step;
    const sourceImageData = sourceImageDataRef.current;
    if (!sourceImageData) {
      setStep({ name: 'error', message: GENERIC_ANALYZE_ERROR });
      return;
    }

    setStep({ name: 'processing' });
    void (async () => {
      try {
        const { cv } = await loadOpenCv();
        const perspectiveCv = cv as unknown as PerspectiveCv;
        const sourceMat = perspectiveCv.matFromImageData(sourceImageData);
        let dewarped;
        try {
          dewarped = dewarpFrame(perspectiveCv, sourceMat, toDetectedCorners(corners));
        } finally {
          sourceMat.delete();
        }

        let grid;
        try {
          grid = estimateBubbleGrid(
            cv as unknown as DetectBubbleGridCv,
            dewarped.mat as CvMat & { rows: number; cols: number },
          );
        } finally {
          dewarped.mat.delete();
        }

        setStep({
          name: 'adjust-grid',
          imageUrl,
          naturalWidth,
          naturalHeight,
          corners,
          questionCount: grid.rows,
          optionsPerQuestion: grid.columns,
          gridConfident: grid.confident,
        });
      } catch {
        setStep({ name: 'error', message: GENERIC_ANALYZE_ERROR });
      }
    })();
  }

  function updateGrid(questionCount: number, optionsPerQuestion: number): void {
    setStep((prev) =>
      prev.name === 'adjust-grid'
        ? { ...prev, questionCount, optionsPerQuestion, generationError: undefined }
        : prev,
    );
  }

  function confirmGrid(): void {
    if (step.name !== 'adjust-grid') return;
    const current = step;
    void (async () => {
      try {
        const geometry = computeCustomTemplateGeometry(
          current.questionCount,
          current.optionsPerQuestion,
        );
        const pdfBytes = await generateTemplatePdf(geometry);
        const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
        const pdfUrl = URL.createObjectURL(blob);
        pdfUrlRef.current = pdfUrl;
        setStep({
          name: 'preview',
          pdfUrl,
          questionCount: current.questionCount,
          optionsPerQuestion: current.optionsPerQuestion,
        });
      } catch (err) {
        const message =
          err instanceof TemplateLayoutTooDenseError
            ? err.message
            : 'Couldn’t generate the PDF. Try again.';
        setStep({ ...current, generationError: message });
      }
    })();
  }

  function reset(): void {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    sourceImageDataRef.current = null;
    setStep({ name: 'upload' });
  }

  return { step, loadFile, updateCorners, confirmCorners, updateGrid, confirmGrid, reset };
}

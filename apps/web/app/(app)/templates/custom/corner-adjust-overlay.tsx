'use client';

import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CornerName, Point } from '@/lib/scanning/corner-markers';

const CORNER_ORDER: readonly CornerName[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

export interface CornerAdjustOverlayProps {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  corners: Record<CornerName, Point>;
  onCornersChange: (corners: Record<CornerName, Point>) => void;
}

/**
 * FR-TPL-02's "drag corners" review step — 4 draggable handles over the
 * uploaded photo, pre-positioned at `detect-sheet-boundary.ts`'s
 * estimate (or a default inset rectangle when nothing was detected).
 *
 * The `<svg>`'s `viewBox` is set to the image's own natural pixel
 * dimensions with `preserveAspectRatio="none"`, so it scales to exactly
 * cover the displayed `<img>` at any CSS size — corner coordinates are
 * always in natural-image-pixel space, matching what
 * `detect-sheet-boundary.ts`/`dewarpFrame` operate in, with no separate
 * display-vs-natural scale factor to track for rendering. Pointer
 * events still arrive in CSS/client pixels, so `clientToNatural` is the
 * one place that conversion happens, during a drag.
 */
export function CornerAdjustOverlay({
  imageUrl,
  naturalWidth,
  naturalHeight,
  corners,
  onCornersChange,
}: CornerAdjustOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<CornerName | null>(null);

  function clientToNatural(clientX: number, clientY: number): Point {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const relX = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
    const relY = rect.height === 0 ? 0 : (clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(naturalWidth, relX * naturalWidth)),
      y: Math.max(0, Math.min(naturalHeight, relY * naturalHeight)),
    };
  }

  function handlePointerDown(name: CornerName, e: ReactPointerEvent<SVGCircleElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = name;
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>): void {
    const name = draggingRef.current;
    if (!name) return;
    onCornersChange({ ...corners, [name]: clientToNatural(e.clientX, e.clientY) });
  }

  function stopDragging(): void {
    draggingRef.current = null;
  }

  const handleRadius = Math.max(naturalWidth, naturalHeight) * 0.018;
  const strokeWidth = Math.max(naturalWidth, naturalHeight) * 0.004;
  const polygonPoints = CORNER_ORDER.map((name) => `${corners[name].x},${corners[name].y}`).join(
    ' ',
  );

  return (
    <div className="relative inline-block max-w-full touch-none select-none">
      {/* eslint-disable-next-line @next/next/no-img-element -- a locally-generated data: URL (image-loading.ts), not a remote image Next's <Image> optimizer has anything to do with */}
      <img
        src={imageUrl}
        alt="Uploaded answer sheet"
        className="block h-auto max-w-full"
        draggable={false}
      />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full touch-none"
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        role="img"
        aria-label="Drag the 4 corner handles to match your sheet's edges"
      >
        <polygon
          points={polygonPoints}
          fill="rgba(16, 185, 129, 0.15)"
          stroke="#10b981"
          strokeWidth={strokeWidth}
        />
        {CORNER_ORDER.map((name) => (
          <circle
            key={name}
            data-testid={`corner-handle-${name}`}
            cx={corners[name].x}
            cy={corners[name].y}
            r={handleRadius}
            fill="#10b981"
            stroke="white"
            strokeWidth={strokeWidth}
            onPointerDown={(e) => handlePointerDown(name, e)}
            className="cursor-grab active:cursor-grabbing"
          />
        ))}
      </svg>
    </div>
  );
}

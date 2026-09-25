'use client';

import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import {
  MAX_CUSTOM_OPTIONS_PER_QUESTION,
  MAX_CUSTOM_QUESTION_COUNT,
  MIN_CUSTOM_OPTIONS_PER_QUESTION,
  MIN_CUSTOM_QUESTION_COUNT,
} from '@/lib/templates/geometry';
import { CornerAdjustOverlay } from './corner-adjust-overlay';
import { useCustomTemplateBuilder } from './use-custom-template-builder';

const SECONDARY_BUTTON_CLASSES =
  'rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900';
const PRIMARY_BUTTON_CLASSES =
  'rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700';
const NUMBER_INPUT_CLASSES =
  'w-28 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

/**
 * M2-003 (FR-TPL-02) — "Custom template creation from photo." All the
 * actual detection/generation logic lives in `useCustomTemplateBuilder`
 * (framework-agnostic decisions) and `lib/templates/*`; this component
 * is purely the step-by-step rendering, matching the established split
 * between `lib/scanning/*` (logic) and `app/(app)/scan/*` (wiring) —
 * see `scan-client.tsx`.
 *
 * Product-copy requirement (this task's own "done when" bar,
 * `docs/TASKS.md`): nowhere on this page claims unattended, 100%-accurate
 * detection. Every automatic step's copy explicitly frames it as an
 * estimate the teacher checks — see the strings below.
 */
export default function CustomTemplateClient() {
  const builder = useCustomTemplateBuilder();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { step } = builder;

  function handleFileSelected(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) builder.loadFile(file);
    e.target.value = '';
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Create a custom template
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Upload a photo of your existing answer sheet. We&rsquo;ll estimate its layout —
          you&rsquo;ll always get a chance to check and adjust it before it&rsquo;s used for
          scoring.
        </p>
      </div>

      {step.name === 'upload' && (
        <div className="flex flex-col items-start gap-2">
          <label
            htmlFor="sheet-photo-input"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Photo of a blank or sample sheet
          </label>
          <input
            id="sheet-photo-input"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelected}
            className="text-sm text-zinc-700 dark:text-zinc-300"
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            For best results, place the sheet on a plain, contrasting surface in good light.
          </p>
        </div>
      )}

      {step.name === 'processing' && (
        <div
          className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400"
          role="status"
          aria-live="polite"
        >
          <div
            className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300"
            aria-hidden="true"
          />
          Analyzing your sheet…
        </div>
      )}

      {step.name === 'error' && (
        <div className="flex flex-col gap-3" role="alert">
          <p className="text-sm text-red-600 dark:text-red-400">{step.message}</p>
          <button
            type="button"
            onClick={builder.reset}
            className={`self-start ${SECONDARY_BUTTON_CLASSES}`}
          >
            Start over
          </button>
        </div>
      )}

      {step.name === 'adjust-corners' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {step.detectionMethod === 'default'
              ? 'We couldn’t automatically find your sheet’s edges — drag the corners so they line up with the paper.'
              : 'We estimated where your sheet’s edges are — drag the corners if they don’t line up exactly.'}
          </p>
          <CornerAdjustOverlay
            imageUrl={step.imageUrl}
            naturalWidth={step.naturalWidth}
            naturalHeight={step.naturalHeight}
            corners={step.corners}
            onCornersChange={builder.updateCorners}
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={builder.confirmCorners}
              className={PRIMARY_BUTTON_CLASSES}
            >
              Looks good
            </button>
            <button type="button" onClick={builder.reset} className={SECONDARY_BUTTON_CLASSES}>
              Start over
            </button>
          </div>
        </div>
      )}

      {step.name === 'adjust-grid' && (
        <div className="flex flex-col gap-4">
          {!step.gridConfident && (
            <p
              className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
              role="status"
            >
              We couldn&rsquo;t confidently estimate your sheet&rsquo;s layout — please check the
              numbers below match your sheet before continuing.
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Number of questions
            <input
              type="number"
              min={MIN_CUSTOM_QUESTION_COUNT}
              max={MAX_CUSTOM_QUESTION_COUNT}
              value={step.questionCount}
              onChange={(e) =>
                builder.updateGrid(
                  Number(e.target.value) || MIN_CUSTOM_QUESTION_COUNT,
                  step.optionsPerQuestion,
                )
              }
              className={NUMBER_INPUT_CLASSES}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Options per question (A, B, C…)
            <input
              type="number"
              min={MIN_CUSTOM_OPTIONS_PER_QUESTION}
              max={MAX_CUSTOM_OPTIONS_PER_QUESTION}
              value={step.optionsPerQuestion}
              onChange={(e) =>
                builder.updateGrid(
                  step.questionCount,
                  Number(e.target.value) || MIN_CUSTOM_OPTIONS_PER_QUESTION,
                )
              }
              className={NUMBER_INPUT_CLASSES}
            />
          </label>
          {step.generationError && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {step.generationError}
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={builder.confirmGrid} className={PRIMARY_BUTTON_CLASSES}>
              Generate template
            </button>
            <button type="button" onClick={builder.reset} className={SECONDARY_BUTTON_CLASSES}>
              Start over
            </button>
          </div>
        </div>
      )}

      {step.name === 'preview' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Your template is ready — {step.questionCount} questions, {step.optionsPerQuestion}{' '}
            options each. Print it, hand out copies, and scan it the same way as a Sharlo stock
            template.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href={step.pdfUrl}
              download="sharlo-custom-template.pdf"
              className={PRIMARY_BUTTON_CLASSES}
            >
              Download PDF
            </a>
            <button
              type="button"
              disabled
              title="Saving templates to your account is coming soon"
              className="cursor-not-allowed rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-400 dark:border-zinc-700 dark:text-zinc-600"
            >
              Save to my templates (coming soon)
            </button>
          </div>
          <button
            type="button"
            onClick={builder.reset}
            className="self-start text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Create another
          </button>
        </div>
      )}
    </div>
  );
}

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomTemplateClient from './custom-template-client';
import type { BuilderStep, UseCustomTemplateBuilderResult } from './use-custom-template-builder';

/**
 * `useCustomTemplateBuilder` itself calls into `loadOpenCv`/OpenCV WASM
 * (via `detectSheetBoundary`/`estimateBubbleGrid`/`dewarpFrame`), which
 * needs a real browser and can't run in jsdom — same reason
 * `scan-client.test.tsx` mocks out every OpenCV-touching hook rather
 * than the real ones. This file only proves the component renders each
 * step correctly and wires button clicks to the hook's functions; the
 * hook's own real logic is proven end-to-end against a real dev server
 * instead (see docs/reports/SHARLO-M2-003.md's "How tested" section).
 */
const { useCustomTemplateBuilderMock } = vi.hoisted(() => ({
  useCustomTemplateBuilderMock: vi.fn(),
}));

vi.mock('./use-custom-template-builder', async () => {
  const actual = await vi.importActual<typeof import('./use-custom-template-builder')>(
    './use-custom-template-builder',
  );
  return { ...actual, useCustomTemplateBuilder: useCustomTemplateBuilderMock };
});

const CORNERS = {
  topLeft: { x: 10, y: 10 },
  topRight: { x: 90, y: 10 },
  bottomRight: { x: 90, y: 90 },
  bottomLeft: { x: 10, y: 90 },
};

function mockBuilder(
  step: BuilderStep,
  overrides: Partial<UseCustomTemplateBuilderResult> = {},
): UseCustomTemplateBuilderResult {
  const result: UseCustomTemplateBuilderResult = {
    step,
    loadFile: vi.fn(),
    updateCorners: vi.fn(),
    confirmCorners: vi.fn(),
    updateGrid: vi.fn(),
    confirmGrid: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
  useCustomTemplateBuilderMock.mockReturnValue(result);
  return result;
}

beforeEach(() => {
  useCustomTemplateBuilderMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('CustomTemplateClient', () => {
  it('shows the file input on the upload step', () => {
    mockBuilder({ name: 'upload' });
    render(<CustomTemplateClient />);
    expect(screen.getByLabelText(/photo of a blank or sample sheet/i)).toBeInTheDocument();
  });

  it('calls loadFile when a file is selected', () => {
    const builder = mockBuilder({ name: 'upload' });
    render(<CustomTemplateClient />);

    const file = new File(['x'], 'sheet.png', { type: 'image/png' });
    const input = screen.getByLabelText(/photo of a blank or sample sheet/i) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(builder.loadFile).toHaveBeenCalledWith(file);
  });

  it('shows a processing indicator on the processing step', () => {
    mockBuilder({ name: 'processing' });
    render(<CustomTemplateClient />);
    expect(screen.getByRole('status')).toHaveTextContent(/analyzing your sheet/i);
  });

  it('shows the error message and a working "Start over" button on the error step', () => {
    const builder = mockBuilder({ name: 'error', message: 'Something went wrong.' });
    render(<CustomTemplateClient />);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
    screen.getByRole('button', { name: /start over/i }).click();
    expect(builder.reset).toHaveBeenCalledTimes(1);
  });

  it('shows the corner-adjust overlay and confirms via "Looks good"', () => {
    const builder = mockBuilder({
      name: 'adjust-corners',
      imageUrl: 'data:image/png;base64,abc',
      naturalWidth: 100,
      naturalHeight: 100,
      corners: CORNERS,
      detectionMethod: 'polygon',
    });
    render(<CustomTemplateClient />);

    expect(screen.getByAltText(/uploaded answer sheet/i)).toBeInTheDocument();
    screen.getByRole('button', { name: /looks good/i }).click();
    expect(builder.confirmCorners).toHaveBeenCalledTimes(1);
  });

  it('shows a "couldn’t find edges" message when detection fell back to a default rectangle', () => {
    mockBuilder({
      name: 'adjust-corners',
      imageUrl: 'data:image/png;base64,abc',
      naturalWidth: 100,
      naturalHeight: 100,
      corners: CORNERS,
      detectionMethod: 'default',
    });
    render(<CustomTemplateClient />);
    expect(screen.getByText(/couldn.t automatically find/i)).toBeInTheDocument();
  });

  it('shows the grid-adjust fields pre-filled with the estimate, and lets the teacher edit them', () => {
    const builder = mockBuilder({
      name: 'adjust-grid',
      imageUrl: 'data:image/png;base64,abc',
      naturalWidth: 100,
      naturalHeight: 100,
      corners: CORNERS,
      questionCount: 15,
      optionsPerQuestion: 4,
      gridConfident: true,
    });
    render(<CustomTemplateClient />);

    const [questionInput, optionsInput] = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    expect(questionInput.value).toBe('15');
    expect(optionsInput.value).toBe('4');
    expect(screen.queryByText(/couldn.t confidently estimate/i)).not.toBeInTheDocument();

    screen.getByRole('button', { name: /generate template/i }).click();
    expect(builder.confirmGrid).toHaveBeenCalledTimes(1);
  });

  it('shows a low-confidence warning when the grid estimate was not confident', () => {
    mockBuilder({
      name: 'adjust-grid',
      imageUrl: 'data:image/png;base64,abc',
      naturalWidth: 100,
      naturalHeight: 100,
      corners: CORNERS,
      questionCount: 20,
      optionsPerQuestion: 4,
      gridConfident: false,
    });
    render(<CustomTemplateClient />);
    expect(screen.getByText(/couldn.t confidently estimate/i)).toBeInTheDocument();
  });

  it('shows an inline generation error without losing the entered values', () => {
    mockBuilder({
      name: 'adjust-grid',
      imageUrl: 'data:image/png;base64,abc',
      naturalWidth: 100,
      naturalHeight: 100,
      corners: CORNERS,
      questionCount: 500,
      optionsPerQuestion: 8,
      gridConfident: true,
      generationError: "500 questions x 8 options doesn't fit legibly on one page.",
    });
    render(<CustomTemplateClient />);
    expect(screen.getByRole('alert')).toHaveTextContent(/doesn.t fit legibly/i);
  });

  it('shows the download link and a disabled, explained "Save" button on the preview step', () => {
    mockBuilder({
      name: 'preview',
      pdfUrl: 'blob:http://localhost/fake-pdf',
      questionCount: 15,
      optionsPerQuestion: 4,
    });
    render(<CustomTemplateClient />);

    const downloadLink = screen.getByRole('link', { name: /download pdf/i });
    expect(downloadLink).toHaveAttribute('href', 'blob:http://localhost/fake-pdf');

    const saveButton = screen.getByRole('button', { name: /save to my templates/i });
    expect(saveButton).toBeDisabled();
  });

  it('never claims unattended 100% accuracy anywhere on the page (FR-TPL-02)', () => {
    mockBuilder({ name: 'upload' });
    const { container } = render(<CustomTemplateClient />);
    const text = container.textContent?.toLowerCase() ?? '';
    for (const phrase of [
      '100% accura',
      'fully automatic',
      'guaranteed accura',
      'perfectly detect',
    ]) {
      expect(text).not.toContain(phrase);
    }
  });
});

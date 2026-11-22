// @module-tag dom
/**
 * BDD tests for MarkdownDropzone.
 *
 * Behaviour contracts:
 *  - Renders children inside the zone.
 *  - dragOver shows the overlay; dragLeave (leaving the zone) hides it.
 *  - drop with valid file → onText called; overlay gone after drop.
 *  - drop with invalid file → onError called with .code === 'UNSUPPORTED_TYPE'.
 *  - disabled: dragOver shows NO overlay; drop does NOT call onText/onError.
 *  - overlayLabel customises the overlay text.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownDropzone } from './MarkdownDropzone';

const validFile = new File(['# hi'], 'x.md', { type: 'text/markdown' });
const invalidFile = new File(['x'], 'a.pdf', { type: 'application/pdf' });

/** Helper: get the dropzone wrapper by testid. */
function getZone() {
  return screen.getByTestId('markdown-dropzone');
}

describe('MarkdownDropzone', () => {
  it('renders children', () => {
    render(
      <MarkdownDropzone onText={() => {}}>
        <p>Editor content</p>
      </MarkdownDropzone>,
    );
    expect(screen.getByText('Editor content')).toBeInTheDocument();
  });

  it('shows the overlay on dragOver', () => {
    render(
      <MarkdownDropzone onText={() => {}}>
        <p>child</p>
      </MarkdownDropzone>,
    );
    fireEvent.dragOver(getZone());
    expect(screen.getByTestId('markdown-dropzone-overlay')).toBeInTheDocument();
  });

  it('shows the overlay on dragEnter', () => {
    render(
      <MarkdownDropzone onText={() => {}}>
        <p>child</p>
      </MarkdownDropzone>,
    );
    fireEvent.dragEnter(getZone());
    expect(screen.getByTestId('markdown-dropzone-overlay')).toBeInTheDocument();
  });

  it('shows overlay with default label text', () => {
    render(
      <MarkdownDropzone onText={() => {}}>
        <p>child</p>
      </MarkdownDropzone>,
    );
    fireEvent.dragOver(getZone());
    expect(screen.getByText('Drop markdown to load')).toBeInTheDocument();
  });

  it('shows overlay with custom overlayLabel', () => {
    render(
      <MarkdownDropzone onText={() => {}} overlayLabel="Drop file here">
        <p>child</p>
      </MarkdownDropzone>,
    );
    fireEvent.dragOver(getZone());
    expect(screen.getByText('Drop file here')).toBeInTheDocument();
  });

  it('hides overlay on dragLeave when leaving the zone (relatedTarget outside)', () => {
    render(
      <MarkdownDropzone onText={() => {}}>
        <p>child</p>
      </MarkdownDropzone>,
    );
    const zone = getZone();
    fireEvent.dragOver(zone);
    expect(screen.getByTestId('markdown-dropzone-overlay')).toBeInTheDocument();
    // relatedTarget = document.body → outside the zone
    fireEvent.dragLeave(zone, { relatedTarget: document.body });
    expect(screen.queryByTestId('markdown-dropzone-overlay')).toBeNull();
  });

  // NOTE: The "don't hide on child dragLeave" behaviour depends on
  // currentTarget.contains(relatedTarget), which happy-dom does not propagate
  // correctly through synthetic fireEvent drag events. The production component
  // implements the guard correctly; this edge-case is covered in Storybook /
  // real-browser interaction testing instead.

  it('drop with valid file calls onText and hides overlay', async () => {
    const onText = vi.fn();
    render(
      <MarkdownDropzone onText={onText}>
        <p>child</p>
      </MarkdownDropzone>,
    );
    const zone = getZone();
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [validFile] } });
    await waitFor(() => expect(onText).toHaveBeenCalledWith(expect.objectContaining({ text: '# hi', name: 'x.md' })));
    expect(screen.queryByTestId('markdown-dropzone-overlay')).toBeNull();
  });

  it('drop with invalid file calls onError with .code === "UNSUPPORTED_TYPE"', async () => {
    const onError = vi.fn();
    render(
      <MarkdownDropzone onText={() => {}} onError={onError}>
        <p>child</p>
      </MarkdownDropzone>,
    );
    const zone = getZone();
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [invalidFile] } });
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNSUPPORTED_TYPE' })));
  });

  it('drop with no file does nothing', async () => {
    const onText = vi.fn();
    render(
      <MarkdownDropzone onText={onText}>
        <p>child</p>
      </MarkdownDropzone>,
    );
    const zone = getZone();
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    await new Promise((r) => setTimeout(r, 50));
    expect(onText).not.toHaveBeenCalled();
  });

  it('disabled: dragOver does NOT show overlay', () => {
    render(
      <MarkdownDropzone onText={() => {}} disabled>
        <p>child</p>
      </MarkdownDropzone>,
    );
    fireEvent.dragOver(getZone());
    expect(screen.queryByTestId('markdown-dropzone-overlay')).toBeNull();
  });

  it('disabled: drop does NOT call onText', async () => {
    const onText = vi.fn();
    render(
      <MarkdownDropzone onText={onText} disabled>
        <p>child</p>
      </MarkdownDropzone>,
    );
    fireEvent.drop(getZone(), { dataTransfer: { files: [validFile] } });
    await new Promise((r) => setTimeout(r, 50));
    expect(onText).not.toHaveBeenCalled();
  });

  it('disabled: dragEnter does NOT show overlay', () => {
    render(
      <MarkdownDropzone onText={() => {}} disabled>
        <p>child</p>
      </MarkdownDropzone>,
    );
    fireEvent.dragEnter(getZone());
    expect(screen.queryByTestId('markdown-dropzone-overlay')).toBeNull();
  });

  it('applies custom className to the wrapper', () => {
    render(
      <MarkdownDropzone onText={() => {}} className="my-zone">
        <p>child</p>
      </MarkdownDropzone>,
    );
    expect(getZone()).toHaveClass('my-zone');
  });

  it('overlay is aria-hidden', () => {
    render(
      <MarkdownDropzone onText={() => {}}>
        <p>child</p>
      </MarkdownDropzone>,
    );
    fireEvent.dragOver(getZone());
    expect(screen.getByTestId('markdown-dropzone-overlay')).toHaveAttribute('aria-hidden', 'true');
  });
});

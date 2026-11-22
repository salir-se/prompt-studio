// @module-tag dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HighlightOverlay } from './HighlightOverlay';

// NB: no manual `document.body.innerHTML = ''` cleanup here — the overlay renders
// via createPortal into document.body, and Testing-Library's auto-cleanup unmounts
// it. Wiping the body first would race that unmount (removeChild on a gone node).
// Each test sets its own fixture at the top.

describe('HighlightOverlay', () => {
  it('renders a dim backdrop portal into document.body', () => {
    document.body.innerHTML = '<button data-help-id="run">Run</button>';
    render(<HighlightOverlay helpIds={['run']} />);
    expect(document.querySelector('[data-help-overlay]')).toBeInTheDocument();
  });

  it('cuts one spotlight hole per resolved target (+ the full-cover mask rect)', () => {
    document.body.innerHTML = '<button data-help-id="a">A</button><button data-help-id="b">B</button>';
    render(<HighlightOverlay helpIds={['a', 'b']} />);
    const mask = document.querySelector('mask');
    // 1 white full-cover rect + 1 black cut-out per resolved target.
    expect(mask?.querySelectorAll('rect')).toHaveLength(3);
  });

  it('does not cut holes for missing/hidden targets', () => {
    document.body.innerHTML = '<button data-help-id="a">A</button>';
    render(<HighlightOverlay helpIds={['a', 'missing']} />);
    expect(document.querySelector('mask')?.querySelectorAll('rect')).toHaveLength(2);
  });

  it('announces the caption via role="status"', () => {
    document.body.innerHTML = '<div data-help-id="x"></div>';
    render(<HighlightOverlay helpIds={['x']} label="This starts a search" />);
    expect(screen.getByRole('status')).toHaveTextContent('This starts a search');
  });

  it('anchors the caption to the spotlight (not the corner) when the target resolves', () => {
    document.body.innerHTML = '<button data-help-id="x">X</button>';
    render(<HighlightOverlay helpIds={['x']} label="Click here" />);
    const callout = document.querySelector('[data-help-callout]') as HTMLElement;
    // Anchored placement is top-positioned below the target; the corner
    // fallback would set `bottom` instead.
    expect(callout.style.top).not.toBe('');
    expect(callout.style.bottom).toBe('');
  });

  it('falls back to the corner when no target resolves', () => {
    document.body.innerHTML = '';
    render(<HighlightOverlay helpIds={['missing']} label="Where did it go" />);
    const callout = document.querySelector('[data-help-callout]') as HTMLElement;
    expect(callout.style.bottom).toBe('16px');
    expect(callout.style.left).toBe('16px');
  });

  it('dismisses via the callout "Done" button', () => {
    document.body.innerHTML = '<div data-help-id="x"></div>';
    const onClear = vi.fn();
    render(<HighlightOverlay helpIds={['x']} label="Read me" onClear={onClear} />);
    screen.getByRole('button', { name: 'Done' }).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('is non-interactive so the user can still click the spotlighted control', () => {
    document.body.innerHTML = '<div data-help-id="x"></div>';
    render(<HighlightOverlay helpIds={['x']} />);
    const overlay = document.querySelector('[data-help-overlay]') as HTMLElement;
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('calls onClear on Escape', () => {
    document.body.innerHTML = '<div data-help-id="x"></div>';
    const onClear = vi.fn();
    render(<HighlightOverlay helpIds={['x']} onClear={onClear} />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

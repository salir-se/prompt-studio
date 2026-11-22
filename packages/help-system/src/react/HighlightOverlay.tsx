import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveTargets } from '../core/resolveTargets';

export interface HighlightOverlayProps {
  /** `data-help-id` values to keep clear (spotlight); everything else is dimmed. */
  helpIds: string[];
  /** Optional caption — announced to screen readers and anchored to the spotlight. */
  label?: string;
  /** Emphasis — affects the spotlight ring color. */
  intent?: 'focus' | 'warn';
  /** Backdrop opacity, 0..1 (default 0.6). */
  dim?: number;
  /** Padding around each spotlight rect, px (default 8). */
  padding?: number;
  /** Called on ESC and by the callout's "Done" button — the user's explicit
   *  exit from highlight mode. */
  onClear?: () => void;
}

const CALLOUT_WIDTH = 320;
const CALLOUT_GAP = 12; // spotlight edge → callout, leaves room for the arrow
const VIEWPORT_MARGIN = 16;

/**
 * AI-controlled spotlight: dims the whole viewport except the resolved `helpIds`
 * (via an SVG mask). **Non-modal** (`pointer-events: none`) so the user can still
 * click the highlighted control — the dim is purely visual. ESC clears, and the
 * cut-outs recompute on scroll/resize so the spotlight tracks the element. The dim
 * is `aria-hidden`; the caption is announced via `role="status"` (ADR-089 §G6).
 *
 * The caption renders as a step box ANCHORED to the first spotlight (below it,
 * flipping above when there is no room), matching the Joyride tour tooltip the
 * user already knows — a floating corner snippet reads as unrelated to the
 * highlighted control. Only when no target resolves does it fall back to the
 * bottom-left corner. The box itself is interactive (a "Got it" dismiss) while
 * the rest of the overlay stays click-through.
 */
export function HighlightOverlay({
  helpIds,
  label,
  intent = 'focus',
  dim = 0.6,
  padding = 8,
  onClear,
}: HighlightOverlayProps) {
  const maskId = `help-spotlight-${useId().replace(/:/g, '')}`;
  const [rects, setRects] = useState<DOMRect[]>([]);
  const calloutRef = useRef<HTMLDivElement | null>(null);
  // 'below' | 'above' relative to the anchor rect; measured after render.
  const [calloutSide, setCalloutSide] = useState<'below' | 'above'>('below');

  useEffect(() => {
    const recompute = () => setRects(resolveTargets(helpIds).map((t) => t.rect));
    recompute();
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [helpIds]);

  useEffect(() => {
    if (!onClear) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClear]);

  const anchor = rects[0];

  // Flip above when the measured box would overflow the viewport bottom.
  useLayoutEffect(() => {
    if (!anchor || !calloutRef.current) return;
    const height = calloutRef.current.offsetHeight;
    const bottomEdge = anchor.bottom + padding + CALLOUT_GAP + height;
    setCalloutSide(bottomEdge > window.innerHeight - VIEWPORT_MARGIN ? 'above' : 'below');
  }, [anchor, padding]);

  if (typeof document === 'undefined') return null;

  const ring = intent === 'warn' ? 'oklch(0.7 0.18 30)' : 'oklch(0.75 0.15 250)';
  const box = (r: DOMRect) => ({
    x: r.left - padding,
    y: r.top - padding,
    width: r.width + padding * 2,
    height: r.height + padding * 2,
  });

  // Anchored placement: horizontally centered on the spotlight, clamped to the
  // viewport; vertically below (default) or above (flipped) the padded box.
  const calloutStyle: React.CSSProperties = { maxWidth: CALLOUT_WIDTH };
  let arrowStyle: React.CSSProperties | null = null;
  if (anchor) {
    const b = box(anchor);
    const left = Math.min(
      Math.max(b.x + b.width / 2 - CALLOUT_WIDTH / 2, VIEWPORT_MARGIN),
      Math.max(window.innerWidth - CALLOUT_WIDTH - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
    );
    calloutStyle.left = left;
    calloutStyle.width = Math.min(CALLOUT_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    if (calloutSide === 'below') {
      calloutStyle.top = b.y + b.height + CALLOUT_GAP;
    } else {
      calloutStyle.bottom = window.innerHeight - b.y + CALLOUT_GAP;
    }
    // Arrow: a rotated square peeking from the box toward the spotlight, kept
    // over the anchor's horizontal center even when the box is clamped.
    const arrowLeft = Math.min(Math.max(b.x + b.width / 2 - 6, left + 12), left + (calloutStyle.width as number) - 24);
    arrowStyle = {
      position: 'fixed',
      left: arrowLeft,
      width: 12,
      height: 12,
      transform: 'rotate(45deg)',
      background: 'var(--popover, #111)',
      ...(calloutSide === 'below'
        ? { top: b.y + b.height + CALLOUT_GAP - 6 }
        : { bottom: window.innerHeight - b.y + CALLOUT_GAP - 6 }),
    };
  } else {
    // Target missing (not mounted / hidden): corner fallback keeps the message visible.
    calloutStyle.left = VIEWPORT_MARGIN;
    calloutStyle.bottom = VIEWPORT_MARGIN;
  }

  return createPortal(
    <div data-help-overlay style={{ position: 'fixed', inset: 0, zIndex: 2147483000, pointerEvents: 'none' }}>
      <svg aria-hidden="true" width="100%" height="100%" style={{ position: 'fixed', inset: 0 }}>
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rects.map((r, i) => (
              <rect key={i} {...box(r)} rx="8" fill="black" />
            ))}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill={`rgba(0,0,0,${dim})`} mask={`url(#${maskId})`} />
        {rects.map((r, i) => (
          <rect key={`ring-${i}`} {...box(r)} rx="8" fill="none" stroke={ring} strokeWidth="2" />
        ))}
      </svg>
      {label ? (
        <>
          {arrowStyle ? <div aria-hidden="true" style={arrowStyle} /> : null}
          <output
            ref={calloutRef as React.Ref<HTMLOutputElement>}
            aria-live="polite"
            data-help-callout
            style={{
              position: 'fixed',
              display: 'block',
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--popover, #111)',
              color: 'var(--popover-foreground, #fff)',
              font: '14px/1.4 system-ui, sans-serif',
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
              pointerEvents: 'auto',
              ...calloutStyle,
            }}
          >
            {label}
            {onClear ? (
              <div style={{ marginTop: 8, textAlign: 'right' }}>
                <button
                  type="button"
                  onClick={onClear}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--primary, #2563eb)',
                    color: 'var(--primary-foreground, #fff)',
                    font: '600 12px/1.2 system-ui, sans-serif',
                    cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </div>
            ) : null}
          </output>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

import { type RefObject, useEffect } from 'react';
import { alongAxis, boxSize, type RailAxis, rectStart } from './timeline-rail-axis';

/**
 * The rail row (0-based, within the drawn window) under a pointer, or null before or past the marks. Positions are
 * along the rail's axis: the pointer's y and the strip's top on a vertical rail, x and left on a horizontal one.
 */
export function hoveredRow(pointer: number, stripStart: number, pitch: number, count: number): number | null {
  if (!(pitch > 0) || count <= 0) return null;
  const row = Math.floor((pointer - stripStart) / pitch);
  return row < 0 || row >= count ? null : row;
}

/** `data-near` of the mark on `index`: "0" on the hovered row, "1" on its neighbours, none elsewhere. */
export function nearValue(hovered: number | null, index: number): '0' | '1' | null {
  if (hovered === null) return null;
  const distance = Math.abs(index - hovered);
  return distance === 0 ? '0' : distance === 1 ? '1' : null;
}

/**
 * Pointer proximity on the rail's ticks: a mouse or pen over the marks sets `data-near` on the hovered mark and
 * its neighbours (the stylesheet scales their ticks). Attributes are written straight to the DOM at most once per
 * frame, never through React state, and touch pointers are ignored. Does nothing while `enabled` is false.
 * The marks are cleared when the pointer leaves, and when the window of marks moves (`start`). `axis` is the axis the
 * marks run along.
 */
export function useTimelineRailPointer({
  enabled,
  marksRef,
  stripRef,
  start,
  count,
  axis = 'y',
}: {
  enabled: boolean;
  marksRef: RefObject<HTMLDivElement | null>;
  stripRef: RefObject<HTMLDivElement | null>;
  start: number;
  count: number;
  axis?: RailAxis;
}): void {
  useEffect(() => {
    const marks = marksRef.current;
    const strip = stripRef.current;
    if (!enabled || !marks || !strip) return;
    let frame = 0;
    let pointer = 0;
    const apply = (hovered: number | null) => {
      strip.querySelectorAll<HTMLElement>('[data-timeline-navigation-mark]').forEach((mark, index) => {
        const next = nearValue(hovered, index);
        if (mark.getAttribute('data-near') === next) return;
        if (next === null) mark.removeAttribute('data-near');
        else mark.setAttribute('data-near', next);
      });
    };
    const paint = () => {
      frame = 0;
      const items = strip.querySelectorAll<HTMLElement>('[data-timeline-navigation-mark]');
      const first = items[0];
      apply(
        hoveredRow(
          pointer,
          rectStart(strip.getBoundingClientRect(), axis),
          first ? boxSize(first, axis) : 0,
          items.length,
        ),
      );
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pointer = alongAxis(event, axis);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const clear = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      apply(null);
    };
    marks.addEventListener('pointermove', onMove);
    marks.addEventListener('pointerleave', clear);
    return () => {
      marks.removeEventListener('pointermove', onMove);
      marks.removeEventListener('pointerleave', clear);
      clear();
    };
  }, [enabled, marksRef, stripRef, start, count, axis]);
}

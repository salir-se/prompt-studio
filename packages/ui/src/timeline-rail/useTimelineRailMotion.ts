import { type RefObject, useLayoutEffect, useRef } from 'react';
import { animateMotion } from '../motion';
import { boxOffset, boxSize, paintedTranslate, type RailAxis } from './timeline-rail-axis';
import { TIMELINE_RAIL_WINDOW } from './timeline-rail-window';

/**
 * FLIP start for the strip after the window moved from `previousStart` to `nextStart`: each mark starts on the row
 * it was drawn on, so a shift down starts the strip lower and new marks enter from the clipped bottom edge.
 * `currentY` is the offset still painted by an earlier slide, so a retarget never jumps.
 */
export function stripSlideFrom(
  previousStart: number,
  nextStart: number,
  pitch: number,
  currentY = 0,
  size = TIMELINE_RAIL_WINDOW,
): number {
  const limit = size * pitch;
  return Math.max(-limit, Math.min(limit, currentY + (nextStart - previousStart) * pitch));
}

/**
 * Whether a window change slides or snaps: a jump longer than the window has no marks in common to slide, and a
 * changed destination count (Expand all, Collapse all, a revealed history) re-numbers every row.
 */
/** The longest window move that still slides when the window is only following the page. */
export const FOLLOW_SLIDE_MAX = 1;

export type RailShiftReason = 'follow' | 'shift';

export function railShiftSlides(
  previousStart: number,
  nextStart: number,
  previousCount: number,
  nextCount: number,
  size = TIMELINE_RAIL_WINDOW,
  { reason = 'shift', resting = true }: { reason?: RailShiftReason; resting?: boolean } = {},
): boolean {
  const distance = Math.abs(nextStart - previousStart);
  if (previousCount !== nextCount || distance > size) return false;
  // A window that follows a fast page scroll moves several rows a frame; sliding each move would keep the strip
  // off its rows and the rail blank, so only a one-mark step onto a resting strip slides.
  return reason === 'shift' || (resting && distance <= FOLLOW_SLIDE_MAX);
}

/**
 * Start (top, or left on a horizontal rail) of the rail row `row` (relative to the window start), from the first
 * mark's start and the row pitch.
 */
export function railRowStart(firstStart: number, row: number, pitch: number): number {
  return firstStart + row * pitch;
}

type Painted = { start: number; activeIndex: number; at: number; count: number; axis: RailAxis };

/**
 * Motion for the timeline rail: the active indicator springs between rows and the strip of marks slides when the
 * window moves, along `axis` (y for a vertical rail, x for a horizontal one). Every position is measured from natural
 * layout (offsetTop / offsetHeight, or offsetLeft / offsetWidth on x, which transforms do not change), and the
 * indicator lives outside the strip so the two transforms never compound. The first paint and a disabled rail never
 * animate; turning motion off cancels any running spring.
 */
export function useTimelineRailMotion({
  enabled,
  reducedMotion,
  start,
  activeIndex,
  count,
  axis = 'y',
  reason = 'shift',
}: {
  enabled: boolean;
  reducedMotion: boolean;
  start: number;
  activeIndex: number;
  count: number;
  axis?: RailAxis;
  /** Why the window last moved: following the page, or a shift the reader asked for. */
  reason?: RailShiftReason;
}): { stripRef: RefObject<HTMLDivElement | null>; indicatorRef: RefObject<HTMLSpanElement | null> } {
  const stripRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const painted = useRef<Painted | null>(null);
  const cancels = useRef<{ strip?: () => void; indicator?: () => void }>({});

  useLayoutEffect(
    () => () => {
      cancels.current.strip?.();
      cancels.current.indicator?.();
    },
    [],
  );

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const indicator = indicatorRef.current;
    if (!enabled || !strip || !indicator) {
      cancels.current.strip?.();
      cancels.current.indicator?.();
      cancels.current = {};
      painted.current = null;
      return;
    }
    const marks = strip.querySelectorAll<HTMLElement>('[data-timeline-navigation-mark]');
    const first = marks[0];
    const pitch = first ? boxSize(first, axis) : 0;
    const row = activeIndex - start;
    const mark = marks[row];
    // An active mark outside the window sits on its would-be row, where the marks container clips it.
    const at =
      boxOffset(strip, axis) +
      (mark ? boxOffset(mark, axis) : railRowStart(first ? boxOffset(first, axis) : 0, row, pitch));
    indicator.style.top = axis === 'y' ? `${at}px` : '';
    indicator.style.left = axis === 'x' ? `${at}px` : '';
    const previous = painted.current;
    painted.current = { start, activeIndex, at, count, axis };
    // First paint, or a rail with no layout (hidden below its breakpoint): nothing to move from.
    if (!previous || !pitch) return;
    const resting = paintedTranslate(strip.style.transform, axis) === 0;
    const slides =
      previous.axis === axis &&
      railShiftSlides(previous.start, start, previous.count, count, TIMELINE_RAIL_WINDOW, { reason, resting });
    if (!slides) {
      // A re-numbered or far-away window, or a rail turned to the other axis, snaps into place; a running slide or
      // glide would point at stale rows.
      cancels.current.strip?.();
      cancels.current.indicator?.();
      cancels.current = {};
      return;
    }
    if (previous.start !== start) {
      cancels.current.strip = animateMotion(
        strip,
        { [axis]: 0 },
        {
          from: { [axis]: stripSlideFrom(previous.start, start, pitch, paintedTranslate(strip.style.transform, axis)) },
          rebase: true,
          spring: 'default',
          reducedMotion,
        },
      );
    }
    const limit = TIMELINE_RAIL_WINDOW * pitch;
    if (previous.at !== at) {
      // A window shift alone moves the indicator with its mark, on the strip's spring.
      const spring = previous.activeIndex === activeIndex ? 'default' : 'snappy';
      cancels.current.indicator = animateMotion(
        indicator,
        { [axis]: 0 },
        {
          from: {
            [axis]: Math.max(
              -limit,
              Math.min(limit, paintedTranslate(indicator.style.transform, axis) + previous.at - at),
            ),
          },
          rebase: true,
          spring,
          reducedMotion,
        },
      );
    }
  }, [enabled, reducedMotion, start, activeIndex, count, axis, reason]);

  return { stripRef, indicatorRef };
}

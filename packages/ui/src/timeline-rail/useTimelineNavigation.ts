import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../use-reduced-motion';
import type { TimelineNavigationItem } from './TimelineNavigator';
import { scrollEvents, viewportTop } from './scroll-viewport';
import { markStep, type RailAxis, railWheelDelta } from './timeline-rail-axis';
import { containIndex, shiftWindow, TIMELINE_RAIL_WINDOW, wheelMarks } from './timeline-rail-window';
import { useTimelineLanding } from './useTimelineLanding';
import type { RailShiftReason } from './useTimelineRailMotion';
import { useTimelineSpy } from './useTimelineSpy';

const JUMP_OFFSET_PX = 12;

/**
 * Controller for the timeline rail: which window of marks is drawn, which mark is active, and what
 * jumping, selecting, paging and wheeling do. Only a jump or a selection reveals a destination. On a horizontal rail
 * (`axis: 'x'`) ArrowLeft / ArrowRight also select and a sideways wheel moves the window; the page scrolls vertically.
 */
export function useTimelineNavigation(
  items: TimelineNavigationItem[],
  viewportRef: RefObject<HTMLElement | null>,
  onReveal: ((key: string) => void) | undefined,
  { animate = false, axis = 'y' }: { animate?: boolean; axis?: RailAxis } = {},
) {
  const reducedMotion = useReducedMotion();
  const spy = useTimelineSpy(items, viewportRef);
  const wheelCarry = useRef(0);
  const expectLanding = useTimelineLanding({ enabled: animate, reducedMotion, held: spy.held });
  const count = items.length;
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.key === spy.key),
  );
  // The window follows the active mark only when it moves, so a wheel over the rail can look elsewhere.
  const [view, setView] = useState<{ start: number; followed: number; reason: RailShiftReason }>({
    start: 0,
    followed: activeIndex,
    reason: 'follow',
  });
  let start = view.start;
  if (view.followed !== activeIndex) {
    start = containIndex(view.start, activeIndex, count);
    setView({ start, followed: activeIndex, reason: 'follow' });
  }
  start = shiftWindow(start, 0, count);
  const end = Math.min(count, start + TIMELINE_RAIL_WINDOW);
  const tabbable = activeIndex >= start && activeIndex < end ? activeIndex : start;
  const marksRef = useRef<HTMLDivElement>(null);
  const focusMark = useRef(false);
  const [requested, setRequested] = useState<{ item: TimelineNavigationItem; focus: boolean } | null>(null);
  const behavior: ScrollBehavior = reducedMotion ? 'instant' : 'smooth';

  // A page scroll brings the active mark back into the window after the wheel looked elsewhere.
  const latest = useRef({ start, activeIndex, count });
  latest.current = { start, activeIndex, count };
  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    const onScroll = () => {
      const { start: at, activeIndex: active, count: total } = latest.current;
      if (active >= at && active < Math.min(total, at + TIMELINE_RAIL_WINDOW)) return;
      setView((previous) => ({
        start: containIndex(previous.start, active, total),
        followed: active,
        reason: 'follow',
      }));
    };
    const events = scrollEvents(root);
    events.addEventListener('scroll', onScroll, { passive: true });
    return () => events.removeEventListener('scroll', onScroll);
  }, [viewportRef]);

  useLayoutEffect(() => {
    if (!focusMark.current) return;
    focusMark.current = false;
    marksRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  });

  useLayoutEffect(() => {
    if (!requested) return;
    setRequested(null);
    const target = document.getElementById(requested.item.targetId);
    const root = viewportRef.current;
    if (!root) return;
    if (requested.item.edge) {
      const top = requested.item.edge === 'start' ? 0 : root.scrollHeight - root.clientHeight;
      root.scrollTo({ top, behavior });
      if (requested.focus && root.tabIndex >= -1 && root.hasAttribute('tabindex')) root.focus({ preventScroll: true });
      return;
    }
    if (!target || !root.contains(target)) return;
    const top = root.scrollTop + target.getBoundingClientRect().top - viewportTop(root);
    // A pane's sticky header reserves its jump clearance through standard scroll padding.
    const offset = Math.max(JUMP_OFFSET_PX, Number.parseFloat(getComputedStyle(root).scrollPaddingTop) || 0);
    root.scrollTo({ top: top - offset, behavior });
    if (requested.focus) target.focus({ preventScroll: true });
  }, [requested, behavior, viewportRef]);

  const go = (index: number, focusTarget: boolean) => {
    const item = items[index];
    if (!item) return;
    onReveal?.(item.key);
    spy.hold(item.key);
    expectLanding(item);
    setRequested({ item, focus: focusTarget });
    if (!focusTarget) focusMark.current = true;
  };
  const nudgeWindow = useCallback(
    (delta: number) =>
      setView((previous) => ({ ...previous, start: shiftWindow(previous.start, delta, count), reason: 'shift' })),
    [count],
  );
  const shiftTo = (next: number) => {
    setView((previous) => ({ ...previous, start: next, reason: 'shift' }));
    focusMark.current = true;
  };
  const onMarkKey = (key: string, index: number): boolean => {
    if (key === 'Enter' || key === ' ') go(index, true);
    else if (markStep(key, axis)) {
      const next = Math.max(0, Math.min(count - 1, index + markStep(key, axis)));
      if (next !== index) go(next, false);
    } else if (key === 'Home') go(0, false);
    else if (key === 'End') go(count - 1, false);
    else if (key === 'PageUp') shiftTo(shiftWindow(start, -TIMELINE_RAIL_WINDOW, count));
    else if (key === 'PageDown') shiftTo(shiftWindow(start, TIMELINE_RAIL_WINDOW, count));
    else return false;
    return true;
  };
  const scrollPage = (direction: -1 | 1) => {
    const root = viewportRef.current;
    if (!root) return;
    const top = root.scrollTop + direction * root.clientHeight * 0.9;
    root.scrollTo({ top: Math.max(0, Math.min(root.scrollHeight - root.clientHeight, top)), behavior });
  };
  // React wheel listeners are passive; a native one can keep the page behind the rail still.
  const navRef = useCallback(
    (nav: HTMLElement | null) => {
      if (!nav) return;
      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const travel = railWheelDelta(event.deltaX, event.deltaY, axis);
        const { marks: delta, carry } = wheelMarks(travel, event.deltaMode, wheelCarry.current);
        wheelCarry.current = carry;
        if (!delta) return;
        setView((previous) => {
          const next = shiftWindow(previous.start, delta, count);
          return next === previous.start ? previous : { ...previous, start: next, reason: 'shift' };
        });
      };
      nav.addEventListener('wheel', onWheel, { passive: false });
      return () => {
        nav.removeEventListener('wheel', onWheel);
      };
    },
    [count, axis],
  );

  return {
    navRef,
    marksRef,
    start,
    shiftReason: view.reason,
    activeIndex,
    held: spy.held,
    marks: items.slice(start, end).map((item, offset) => ({
      item,
      index: start + offset,
      active: start + offset === activeIndex,
      tabbable: start + offset === tabbable,
    })),
    up: spy.up,
    down: spy.down,
    jump: (index: number) => go(index, true),
    nudgeWindow,
    onMarkKey,
    scrollPage,
  };
}

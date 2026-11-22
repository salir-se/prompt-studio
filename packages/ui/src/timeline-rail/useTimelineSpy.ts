import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { TimelineNavigationItem } from './TimelineNavigator';
import { scrollEvents, viewportTop } from './scroll-viewport';
import { activeDestination } from './timeline-rail-window';

/** A jump hold ends this long after the last scroll event when no `scrollend` arrives. */
export const JUMP_SETTLE_MS = 150;

interface SpyPosition {
  key: string | undefined;
  up: boolean;
  down: boolean;
}

/**
 * Tracks which destination the reader is in and whether the viewport can scroll each way.
 *
 * Destination offsets are cached and re-measured only when the viewport content mounts, unmounts or
 * resizes; an ordinary scroll reads only the viewport's own scroll metrics, at most once per frame.
 * `hold(key)` pins the active destination during a jump until the viewport's scroll ends. After that the
 * chosen destination stays active while it is in view, until the reader scrolls: a destination near the
 * content start or end cannot reach the reading line, and would otherwise lose its highlight to a boundary.
 * `held` is true while a jump holds its destination.
 */
export function useTimelineSpy(items: TimelineNavigationItem[], viewportRef: RefObject<HTMLElement | null>) {
  const [position, setPosition] = useState<SpyPosition>(() => ({
    key: items[0]?.key,
    up: false,
    down: false,
  }));
  const held = useRef<string | null>(null);
  // Mirrors `held` for rendering: true from a jump until its scroll ends.
  const [holding, setHolding] = useState(false);
  const settled = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const schedule = useRef<() => void>(() => {});
  // Resubscribe only when the destinations change, not when an unmemoized parent passes a new array.
  const signature = items.map((item) => `${item.key}\u0000${item.targetId}\u0000${item.edge ?? ''}`).join('\n');

  const release = useCallback(() => {
    clearTimeout(timer.current);
    if (held.current === null) return;
    settled.current = held.current;
    held.current = null;
    setHolding(false);
    schedule.current();
  }, []);
  const settle = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(release, JUMP_SETTLE_MS);
  }, [release]);
  const hold = useCallback(
    (key: string) => {
      held.current = key;
      settled.current = null;
      setHolding(true);
      setPosition((previous) => (previous.key === key ? previous : { ...previous, key }));
      settle();
    },
    [settle],
  );

  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    const destinations = signature
      ? signature.split('\n').map((line) => {
          const [key = '', targetId = '', edge = ''] = line.split('\u0000');
          return { key, targetId, edge };
        })
      : [];
    let offsets: (number | null)[] = [];
    let dirty = true;
    let frame = 0;
    const measure = () => {
      const origin = viewportTop(root) - root.scrollTop;
      offsets = destinations.map(({ targetId, edge }) => {
        if (edge === 'start') return 0;
        if (edge === 'end') return root.scrollHeight;
        const element = document.getElementById(targetId);
        return element && root.contains(element) ? element.getBoundingClientRect().top - origin : null;
      });
      dirty = false;
    };
    const inView = (key: string) => {
      const item = destinations.find((destination) => destination.key === key);
      if (item?.edge === 'start') return root.scrollTop <= 1;
      if (item?.edge === 'end') return root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
      const targetId = item?.targetId;
      const element = targetId ? document.getElementById(targetId) : null;
      if (!element || !root.contains(element)) return false;
      const start = viewportTop(root);
      const { top } = element.getBoundingClientRect();
      return top >= start - 1 && top < start + root.clientHeight;
    };
    const update = () => {
      frame = 0;
      if (dirty) measure();
      const { scrollTop, clientHeight, scrollHeight } = root;
      const overflow = scrollHeight > clientHeight + 1;
      const up = overflow && scrollTop > 1;
      const down = overflow && scrollTop + clientHeight < scrollHeight - 1;
      if (settled.current !== null && !inView(settled.current)) settled.current = null;
      const spied = settled.current ?? destinations[activeDestination(offsets, root)]?.key;
      setPosition((previous) => {
        const key = held.current ?? spied ?? previous.key;
        const same = key === previous.key && up === previous.up && down === previous.down;
        return same ? previous : { key, up, down };
      });
    };
    const request = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const invalidate = () => {
      dirty = true;
      request();
    };
    const onScroll = () => {
      if (held.current !== null) settle();
      else settled.current = null;
      request();
    };
    schedule.current = request;
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(invalidate);
    const observeContent = () => {
      resize?.observe(root);
      // Revealing history changes content height while the viewport itself stays fixed.
      for (const child of root.children) resize?.observe(child);
    };
    const mutation =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver(() => {
            observeContent();
            invalidate();
          });
    observeContent();
    mutation?.observe(root, { childList: true, subtree: true });
    const events = scrollEvents(root);
    events.addEventListener('scroll', onScroll, { passive: true });
    // Browsers without `scrollend` fall back to the settle timer armed by every scroll event.
    events.addEventListener('scrollend', release);
    if (held.current !== null) settle();
    update();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer.current);
      schedule.current = () => {};
      events.removeEventListener('scroll', onScroll);
      events.removeEventListener('scrollend', release);
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, [signature, viewportRef, release, settle]);

  return { ...position, held: holding, hold };
}

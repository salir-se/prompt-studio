import { type RefObject, useEffect, useRef } from 'react';
import type { TimelineNavigationItem } from './TimelineNavigator';
import { viewportTop } from './scroll-viewport';
import { alongAxis, boxSize, type RailAxis, rectStart } from './timeline-rail-axis';
import { hoveredRow } from './useTimelineRailPointer';

/** A press that moves less than this stays a click. */
export const DRAG_THRESHOLD_PX = 4;
/** Drag distance past the threshold at which the page scrolls at full speed. */
export const DRAG_RANGE_PX = 160;
export const DRAG_MAX_PX_PER_S = 2400;
/** How often a finger held past the first or last mark walks the window one mark on. */
export const TOUCH_WALK_MS = 120;
const TOUCH_JUMP_OFFSET_PX = 12;

/**
 * Page speed, in px per second, for a pointer `delta` px from where it pressed along the rail: nothing inside the
 * threshold, then a quadratic ramp to the maximum, so a short drag crawls and a long one flies. The sign is the
 * direction: down, or right on a horizontal rail, scrolls the page down.
 */
export function dragVelocity(delta: number): number {
  const distance = Math.abs(delta);
  if (distance <= DRAG_THRESHOLD_PX) return 0;
  const ramp = Math.min(1, (distance - DRAG_THRESHOLD_PX) / DRAG_RANGE_PX);
  return Math.sign(delta) * ramp * ramp * DRAG_MAX_PX_PER_S;
}

/**
 * Press-and-drag on the rail's marks scrolls the conversation. A mouse or pen past the threshold moves the viewport
 * every frame by `dragVelocity` of the pointer's distance from the press: a short drag crawls, a long one flies, in
 * either direction. A finger follows instead: the page jumps to the destination under the finger, and a finger held
 * past the first or last mark walks the window one mark every `TOUCH_WALK_MS`. The nav carries `data-dragging`
 * meanwhile, and the click the browser fires after a drag is swallowed so the mark under the pointer is not jumped
 * to. A press that never moves stays an ordinary click. Distances are read along `axis`, the axis the marks run
 * along; the page scrolls vertically on both.
 */
export function useTimelineRailDrag({
  marksRef,
  viewportRef,
  items,
  nudgeWindow,
  axis = 'y',
  onDragChange,
}: {
  marksRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLElement | null>;
  items: TimelineNavigationItem[];
  nudgeWindow: (delta: number) => void;
  axis?: RailAxis;
  /** Called with true when a drag starts and false when it ends. */
  onDragChange?: (dragging: boolean) => void;
}): void {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onDragChangeRef = useRef(onDragChange);
  onDragChangeRef.current = onDragChange;
  useEffect(() => {
    const marks = marksRef.current;
    if (!marks) return;
    const nav = marks.closest<HTMLElement>('[data-timeline-navigator]');
    let pointerId = -1;
    let origin = 0;
    let dragging = false;
    let swallowClick = false;
    let velocity = 0;
    let frame = 0;
    let last = 0;
    let touch = false;
    let finger = 0;
    let walk: ReturnType<typeof setTimeout> | undefined;
    const buttons = () => [...marks.querySelectorAll<HTMLElement>('[data-timeline-navigation-mark]')];
    const jumpTo = (button: HTMLElement | undefined) => {
      const root = viewportRef.current;
      const item = itemsRef.current[Number(button?.dataset.index)];
      const target = item ? document.getElementById(item.targetId) : null;
      if (!root || !item) return;
      if (item.edge) {
        root.scrollTo({ top: item.edge === 'start' ? 0 : root.scrollHeight, behavior: 'instant' });
        return;
      }
      if (!target || !root.contains(target)) return;
      const top = root.scrollTop + target.getBoundingClientRect().top - viewportTop(root);
      root.scrollTo({ top: Math.max(0, top - TOUCH_JUMP_OFFSET_PX), behavior: 'instant' });
    };
    // The finger's row, or past which edge it sits; the first mark's box gives the pitch and the strip start.
    const followFinger = () => {
      const all = buttons();
      const first = all[0];
      if (!first) return;
      const pitch = boxSize(first, axis);
      const stripStart = rectStart((first.parentElement ?? first).getBoundingClientRect(), axis);
      const row = hoveredRow(finger, stripStart, pitch, all.length);
      if (row !== null) {
        clearTimeout(walk);
        walk = undefined;
        jumpTo(all[row]);
        return;
      }
      const direction = finger < stripStart ? -1 : 1;
      if (walk) return;
      const tick = () => {
        nudgeWindow(direction);
        // The window moved under the still finger: the edge mark is now another destination.
        const edge = buttons();
        jumpTo(direction < 0 ? edge[0] : edge.at(-1));
        walk = setTimeout(tick, TOUCH_WALK_MS);
      };
      walk = setTimeout(tick, TOUCH_WALK_MS);
    };
    const step = () => {
      frame = 0;
      const root = viewportRef.current;
      if (!root || !dragging) return;
      const now = performance.now();
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      const limit = Math.max(0, root.scrollHeight - root.clientHeight);
      root.scrollTop = Math.max(0, Math.min(limit, root.scrollTop + velocity * dt));
      frame = requestAnimationFrame(step);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(walk);
      walk = undefined;
      if (dragging) onDragChangeRef.current?.(false);
      dragging = false;
      nav?.removeAttribute('data-dragging');
      if (pointerId >= 0 && marks.hasPointerCapture?.(pointerId)) marks.releasePointerCapture(pointerId);
      pointerId = -1;
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      origin = alongAxis(event, axis);
      touch = event.pointerType === 'touch';
      swallowClick = false;
      velocity = 0;
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      finger = alongAxis(event, axis);
      const delta = finger - origin;
      velocity = dragVelocity(delta);
      if (!dragging) {
        if (Math.abs(delta) <= DRAG_THRESHOLD_PX) return;
        dragging = true;
        nav?.setAttribute('data-dragging', '');
        onDragChangeRef.current?.(true);
        marks.setPointerCapture?.(event.pointerId);
        last = performance.now();
        if (!touch) frame = requestAnimationFrame(step);
      }
      if (touch) followFinger();
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      swallowClick = dragging;
      stop();
    };
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
      event.preventDefault();
    };
    marks.addEventListener('pointerdown', onDown);
    marks.addEventListener('pointermove', onMove);
    marks.addEventListener('pointerup', onUp);
    marks.addEventListener('pointercancel', onUp);
    window.addEventListener('pointerup', onUp);
    marks.addEventListener('click', onClick, true);
    return () => {
      stop();
      marks.removeEventListener('pointerdown', onDown);
      marks.removeEventListener('pointermove', onMove);
      marks.removeEventListener('pointerup', onUp);
      marks.removeEventListener('pointercancel', onUp);
      window.removeEventListener('pointerup', onUp);
      marks.removeEventListener('click', onClick, true);
    };
  }, [marksRef, viewportRef, nudgeWindow, axis]);
}

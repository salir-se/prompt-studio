/** How many consecutive destinations the timeline rail draws as individual marks. */
export const TIMELINE_RAIL_WINDOW = 20;

/** The reader is "in" a destination once its top passes this far below the viewport top. */
export const READING_LINE_PX = 16;

function clampStart(start: number, count: number, size: number): number {
  return Math.max(0, Math.min(start, count - size));
}

/** How many marks stay visible beyond the active one, so the reader sees what comes next. */
export const TIMELINE_RAIL_LOOKAHEAD = 5;

/** Moves the window the minimum amount that keeps `index` at least `lookahead` marks from either edge. */
export function containIndex(
  start: number,
  index: number,
  count: number,
  size = TIMELINE_RAIL_WINDOW,
  lookahead = TIMELINE_RAIL_LOOKAHEAD,
): number {
  if (index < start + lookahead) return clampStart(index - lookahead, count, size);
  if (index > start + size - 1 - lookahead) return clampStart(index - size + 1 + lookahead, count, size);
  return clampStart(start, count, size);
}

/** Shifts the window by `delta` marks, keeping it inside the destinations. */
export function shiftWindow(start: number, delta: number, count: number, size = TIMELINE_RAIL_WINDOW): number {
  return clampStart(start + delta, count, size);
}

/**
 * Index of the destination the reader is in, from cached content offsets (`null` = not in the DOM):
 * the first at the top, the last at the bottom, otherwise the last whose top passed the reading line.
 * Returns -1 when no destination is mounted.
 */
export function activeDestination(
  offsets: readonly (number | null)[],
  viewport: { scrollTop: number; clientHeight: number; scrollHeight: number },
): number {
  const present = offsets.flatMap((offset, index) => (offset === null ? [] : [index]));
  if (!present.length) return -1;
  if (viewport.scrollTop <= 1) return present[0]!;
  if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1) return present.at(-1)!;
  const line = viewport.scrollTop + READING_LINE_PX;
  const passed = present.filter((index) => offsets[index]! <= line);
  return passed.at(-1) ?? present[0]!;
}

/** Wheel travel per mark in pixel mode, and the most marks one event may move: a flick cannot fling the window. */
export const WHEEL_PX_PER_MARK = 40;
export const WHEEL_MAX_MARKS = 3;

/**
 * Turns one wheel event into a whole number of marks. Pixel travel accumulates in `carry` across events, so a
 * trackpad's small ticks add up and a mouse notch moves two or three marks; line mode counts lines and page mode
 * whole windows. More than `WHEEL_MAX_MARKS` in one event is capped and the excess dropped.
 */
export function wheelMarks(deltaY: number, deltaMode: number, carry: number): { marks: number; carry: number } {
  const cap = (marks: number) => Math.max(-WHEEL_MAX_MARKS, Math.min(WHEEL_MAX_MARKS, marks));
  if (deltaMode !== 0) {
    return { marks: cap(Math.trunc(deltaMode === 1 ? deltaY : deltaY * TIMELINE_RAIL_WINDOW)), carry: 0 };
  }
  const total = carry + deltaY;
  const whole = Math.trunc(total / WHEEL_PX_PER_MARK);
  if (Math.abs(whole) > WHEEL_MAX_MARKS) return { marks: cap(whole), carry: 0 };
  return { marks: whole, carry: total - whole * WHEEL_PX_PER_MARK };
}

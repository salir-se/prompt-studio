/** Which way the rail control is laid out. The page it navigates scrolls vertically either way. */
export type TimelineRailOrientation = 'vertical' | 'horizontal';

/** The axis the rail's marks run along: `y` for a vertical rail, `x` for a horizontal one. */
export type RailAxis = 'x' | 'y';

export function railAxis(orientation: TimelineRailOrientation | undefined): RailAxis {
  return orientation === 'horizontal' ? 'x' : 'y';
}

/** A pointer's coordinate along the axis. */
export function alongAxis(point: { clientX: number; clientY: number }, axis: RailAxis): number {
  return axis === 'x' ? point.clientX : point.clientY;
}

/** A box's layout size along the axis: the row pitch of a mark. */
export function boxSize(box: { offsetWidth: number; offsetHeight: number }, axis: RailAxis): number {
  return axis === 'x' ? box.offsetWidth : box.offsetHeight;
}

/** A box's layout offset along the axis, which transforms do not change. */
export function boxOffset(box: { offsetLeft: number; offsetTop: number }, axis: RailAxis): number {
  return axis === 'x' ? box.offsetLeft : box.offsetTop;
}

/** Where a client rect starts along the axis. */
export function rectStart(rect: { left: number; top: number }, axis: RailAxis): number {
  return axis === 'x' ? rect.left : rect.top;
}

/**
 * The selection step of a key on a mark: -1 previous, 1 next, 0 not a step key. ArrowUp and ArrowDown step on both
 * axes; ArrowLeft and ArrowRight step only on a horizontal rail.
 */
export function markStep(key: string, axis: RailAxis): -1 | 0 | 1 {
  if (key === 'ArrowUp' || (axis === 'x' && key === 'ArrowLeft')) return -1;
  if (key === 'ArrowDown' || (axis === 'x' && key === 'ArrowRight')) return 1;
  return 0;
}

/** The wheel travel that moves the window: a horizontal rail takes a sideways scroll when there is one. */
export function railWheelDelta(deltaX: number, deltaY: number, axis: RailAxis): number {
  return axis === 'x' && deltaX !== 0 ? deltaX : deltaY;
}

/** The translate a running `animateMotion` painted on an element along the axis, 0 at rest. */
export function paintedTranslate(transform: string, axis: RailAxis): number {
  const pattern = axis === 'x' ? /translateX\((-?[\d.]+(?:e-?\d+)?)px\)/ : /translateY\((-?[\d.]+(?:e-?\d+)?)px\)/;
  const match = pattern.exec(transform);
  return match ? Number(match[1]) : 0;
}

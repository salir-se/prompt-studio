export const CONNECTION_SIDES = ['left', 'right', 'top', 'bottom'] as const;
type Side = (typeof CONNECTION_SIDES)[number];
export interface FacingBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Pair {
  source: Side;
  target: Side;
}

function midpoint(bounds: FacingBounds, side: Side) {
  return {
    x: bounds.x + (side === 'left' ? 0 : side === 'right' ? bounds.width : bounds.width / 2),
    y: bounds.y + (side === 'top' ? 0 : side === 'bottom' ? bounds.height : bounds.height / 2),
  };
}

/** Opposed native handles keep curves direct and rounded orthogonal routes predictable. */
export function closestFacingHandles(source: FacingBounds, target: FacingBounds) {
  const pairs: Pair[] = [];
  if (source.x + source.width <= target.x) pairs.push({ source: 'right', target: 'left' });
  else if (target.x + target.width <= source.x) pairs.push({ source: 'left', target: 'right' });
  if (source.y + source.height <= target.y) pairs.push({ source: 'bottom', target: 'top' });
  else if (target.y + target.height <= source.y) pairs.push({ source: 'top', target: 'bottom' });
  if (!pairs.length) {
    pairs.push(
      source.x + source.width / 2 <= target.x + target.width / 2
        ? { source: 'right', target: 'left' }
        : { source: 'left', target: 'right' },
    );
    pairs.push(
      source.y + source.height / 2 <= target.y + target.height / 2
        ? { source: 'bottom', target: 'top' }
        : { source: 'top', target: 'bottom' },
    );
  }
  const distance = (pair: Pair) => {
    const from = midpoint(source, pair.source);
    const to = midpoint(target, pair.target);
    return (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
  };
  // Preserve insertion order on ties, so exact diagonals and overlap do not flicker.
  const pair = pairs.reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best));
  return { sourceHandle: `source-${pair.source}`, targetHandle: `target-${pair.target}` };
}

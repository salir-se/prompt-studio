import { EDGE_LABEL_NODE_GAP } from './layout';

export const EDGE_ROUTE_OFFSET = 20;
export interface EdgeLabelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
type EdgeSide = 'left' | 'right' | 'top' | 'bottom';
interface LabelPlacement {
  center: { x: number; y: number };
  labelWidth: number;
  labelHeight: number;
  nodeBounds: readonly EdgeLabelBounds[];
}

/** Keep the label on the smooth-step middle segment, outside every padded node rectangle. */
export function placeEdgeLabel(input: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition?: EdgeSide;
  targetPosition?: EdgeSide;
  preferredX?: number;
  labelWidth: number;
  labelHeight: number;
  nodeBounds: readonly EdgeLabelBounds[];
}): { x: number; y: number } {
  const source = input.sourcePosition ?? 'right';
  const target = input.targetPosition ?? 'left';
  const horizontal = source === 'left' || source === 'right';
  const direction = (side: EdgeSide) => (side === 'right' || side === 'bottom' ? 1 : -1);
  const sourceGap = (horizontal ? input.sourceX : input.sourceY) + direction(source) * EDGE_ROUTE_OFFSET;
  const targetGap = (horizontal ? input.targetX : input.targetY) + direction(target) * EDGE_ROUTE_OFFSET;
  // Match native smooth-step's opposite-handle split, including equal gapped endpoints.
  const vertical = horizontal === (direction(source) === (sourceGap < targetGap ? 1 : -1));
  const middleX = (input.sourceX + input.targetX) / 2;
  const middleY = (input.sourceY + input.targetY) / 2;
  const center = { x: vertical ? (input.preferredX ?? middleX) : middleX, y: middleY };
  const free = nearestFreeCoordinate({ ...input, center }, vertical ? 'x' : 'y');
  return vertical ? { x: free, y: center.y } : { x: center.x, y: free };
}

/** Manual layout keeps the native route compact; the caption may move independently to clear nodes. */
export function placeCompactEdgeLabel(input: LabelPlacement): { x: number; y: number } {
  const x = nearestFreeCoordinate(input, 'x');
  const y = nearestFreeCoordinate(input, 'y');
  return Math.abs(x - input.center.x) <= Math.abs(y - input.center.y)
    ? { x, y: input.center.y }
    : { x: input.center.x, y };
}

function nearestFreeCoordinate(input: LabelPlacement, axis: 'x' | 'y'): number {
  const alongX = axis === 'x';
  const preferred = input.center[axis];
  const fixed = alongX ? input.center.y : input.center.x;
  const halfSize = (alongX ? input.labelWidth : input.labelHeight) / 2;
  const halfCrossSize = (alongX ? input.labelHeight : input.labelWidth) / 2;
  const intervals = input.nodeBounds
    .filter((node) => {
      const crossStart = alongX ? node.y : node.x;
      const crossEnd = crossStart + (alongX ? node.height : node.width);
      return (
        fixed + halfCrossSize + EDGE_LABEL_NODE_GAP > crossStart &&
        fixed - halfCrossSize - EDGE_LABEL_NODE_GAP < crossEnd
      );
    })
    .map((node) => {
      const start = alongX ? node.x : node.y;
      return [
        start - halfSize - EDGE_LABEL_NODE_GAP,
        start + (alongX ? node.width : node.height) + halfSize + EDGE_LABEL_NODE_GAP,
      ] as const;
    })
    .sort((first, second) => first[0] - second[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of intervals) {
    const previous = merged.at(-1);
    if (previous && start < previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  const blocked = merged.find(([start, end]) => start < preferred && preferred < end);
  return !blocked ? preferred : preferred - blocked[0] <= blocked[1] - preferred ? blocked[0] : blocked[1];
}

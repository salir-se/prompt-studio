// @vitest-environment node
// @module-tag pure
import { describe, expect, it } from 'vitest';
import { type EdgeLabelBounds, placeCompactEdgeLabel, placeEdgeLabel } from './edge-label-placement';

const forward = {
  sourceX: 0,
  sourceY: 0,
  targetX: 600,
  targetY: 200,
  preferredX: 400,
  labelWidth: 84,
  labelHeight: 20,
  nodeBounds: [] as EdgeLabelBounds[],
};

describe('#2536: labels remain on the smooth-step middle segment and clear every node', () => {
  it('preserves the preferred automatic gutter if it is already free', () => {
    expect(placeEdgeLabel(forward)).toEqual({ x: 400, y: 100 });
    expect(placeEdgeLabel({ ...forward, preferredX: undefined })).toEqual({ x: 300, y: 100 });
  });

  it('uses the measured label width and padding to choose the nearest free boundary', () => {
    const node = { x: 360, y: 80, width: 80, height: 40 };
    expect(placeEdgeLabel({ ...forward, nodeBounds: [node] })).toEqual({ x: 302, y: 100 });
    expect(placeEdgeLabel({ ...forward, preferredX: 430, nodeBounds: [node] })).toEqual({ x: 498, y: 100 });
  });

  it('merges overlapping blockers so an intermediate node cannot cover the chosen boundary', () => {
    const nodeBounds = [
      { x: 360, y: 80, width: 80, height: 40 },
      { x: 250, y: 90, width: 100, height: 20 },
    ];
    expect(placeEdgeLabel({ ...forward, nodeBounds })).toEqual({ x: 498, y: 100 });
    expect(placeEdgeLabel({ ...forward, nodeBounds: [...nodeBounds].reverse() })).toEqual({ x: 498, y: 100 });
  });

  it('allows an exact 16px gap without moving the label unnecessarily', () => {
    const nodeBounds = [
      { x: 242, y: 80, width: 100, height: 40 },
      { x: 458, y: 80, width: 100, height: 40 },
    ];
    expect(placeEdgeLabel({ ...forward, nodeBounds })).toEqual({ x: 400, y: 100 });
  });

  it('ignores a node already separated vertically by 16px', () => {
    const nodeBounds = [{ x: 360, y: 126, width: 80, height: 40 }];
    expect(placeEdgeLabel({ ...forward, nodeBounds })).toEqual({ x: 400, y: 100 });
  });

  it.each([
    { sourceX: 600, targetX: 0 },
    { sourceX: 0, targetX: 20 },
    { sourceX: 0, targetX: 40 },
  ])('moves along the horizontal segment for reversed or close endpoints: %j', (endpoints) => {
    const middleX = (endpoints.sourceX + endpoints.targetX) / 2;
    const nodeBounds = [{ x: middleX - 40, y: 80, width: 80, height: 40 }];
    expect(placeEdgeLabel({ ...forward, ...endpoints, nodeBounds })).toEqual({ x: middleX, y: 54 });
  });

  it('uses the vertical segment once the two 20px handle offsets no longer overlap', () => {
    expect(placeEdgeLabel({ ...forward, targetX: 41 })).toEqual({ x: 400, y: 100 });
  });

  it('accounts for tall measured labels and obstacles at negative coordinates', () => {
    const nodeBounds = [{ x: -140, y: -120, width: 80, height: 40 }];
    expect(
      placeEdgeLabel({
        ...forward,
        sourceX: 0,
        targetX: -200,
        sourceY: -200,
        targetY: 0,
        labelHeight: 80,
        nodeBounds,
      }),
    ).toEqual({ x: -100, y: -176 });
  });

  it.each([
    {
      sourcePosition: 'left' as const,
      targetPosition: 'right' as const,
      sourceX: 600,
      sourceY: 0,
      targetX: 0,
      targetY: 200,
      expected: { x: 202, y: 100 },
    },
    {
      sourcePosition: 'bottom' as const,
      targetPosition: 'top' as const,
      sourceX: 0,
      sourceY: 0,
      targetX: 200,
      targetY: 600,
      expected: { x: 100, y: 254 },
    },
    {
      sourcePosition: 'top' as const,
      targetPosition: 'bottom' as const,
      sourceX: 0,
      sourceY: 600,
      targetX: 200,
      targetY: 0,
      expected: { x: 100, y: 254 },
    },
  ])('#2540: uses the actual facing-side middle segment for $sourcePosition → $targetPosition clearance', (route) => {
    const { expected, ...endpoints } = route;
    const middleX = (route.sourceX + route.targetX) / 2;
    const middleY = (route.sourceY + route.targetY) / 2;
    const nodeBounds = [{ x: middleX - 40, y: middleY - 20, width: 80, height: 40 }];
    const input = { ...forward, ...endpoints, preferredX: undefined, nodeBounds };
    expect(placeEdgeLabel(input)).toEqual(expected);
  });
});

describe('#2540: compact captions choose the nearer safe axis without altering routing', () => {
  const caption = { center: { x: 0, y: 0 }, labelWidth: 84, labelHeight: 20, nodeBounds: [] as EdgeLabelBounds[] };

  it('preserves the native label center when no node obstructs it', () => {
    expect(placeCompactEdgeLabel(caption)).toEqual({ x: 0, y: 0 });
  });

  it('moves vertically when the caption cannot fit in a narrow horizontal gap', () => {
    const nodeBounds = [
      { x: -200, y: -18, width: 200, height: 36 },
      { x: 70, y: -18, width: 200, height: 36 },
    ];
    expect(placeCompactEdgeLabel({ ...caption, center: { x: 35, y: 0 }, nodeBounds })).toEqual({ x: 35, y: -44 });
  });

  it('moves horizontally when clearing a tall obstacle costs less than clearing it vertically', () => {
    const nodeBounds = [{ x: -5, y: -100, width: 10, height: 200 }];
    expect(placeCompactEdgeLabel({ ...caption, nodeBounds })).toEqual({ x: -63, y: 0 });
  });

  it('uses the measured height and preserves an exact safe boundary', () => {
    const nodeBounds = [{ x: -50, y: -20, width: 100, height: 40 }];
    expect(placeCompactEdgeLabel({ ...caption, labelHeight: 80, nodeBounds })).toEqual({ x: 0, y: -76 });
    expect(placeCompactEdgeLabel({ ...caption, center: { x: 0, y: -76 }, labelHeight: 80, nodeBounds })).toEqual({
      x: 0,
      y: -76,
    });
  });
});

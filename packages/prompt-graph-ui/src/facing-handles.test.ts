// @module-tag pure
import { expect, it } from 'vitest';
import { closestFacingHandles, type FacingBounds } from './facing-handles';

const square: FacingBounds = { x: 0, y: 0, width: 100, height: 100 };

it.each([
  [{ x: 220, y: 20, width: 100, height: 60 }, 'right', 'left'],
  [{ x: -220, y: 20, width: 100, height: 60 }, 'left', 'right'],
  [{ x: 0, y: 220, width: 100, height: 100 }, 'bottom', 'top'],
  [{ x: 0, y: -220, width: 100, height: 100 }, 'top', 'bottom'],
  [{ x: 300, y: 180, width: 100, height: 100 }, 'right', 'left'],
  [{ x: 180, y: 300, width: 100, height: 100 }, 'bottom', 'top'],
  [{ x: 180, y: -300, width: 100, height: 100 }, 'top', 'bottom'],
  [{ x: -300, y: 180, width: 100, height: 100 }, 'left', 'right'],
  [{ x: 200, y: 200, width: 100, height: 100 }, 'right', 'left'],
  [{ x: 100, y: 0, width: 100, height: 100 }, 'right', 'left'],
] as const)('#2540: chooses the closest opposed side midpoints for %j', (target, sourceSide, targetSide) => {
  expect(closestFacingHandles(square, target)).toEqual({
    sourceHandle: `source-${sourceSide}`,
    targetHandle: `target-${targetSide}`,
  });
});

it.each([
  [{ x: 0, y: 0, width: 400, height: 20 }, { x: 420, y: 30, width: 20, height: 400 }, 'right', 'left'],
  [{ x: 0, y: 0, width: 20, height: 400 }, { x: 30, y: 420, width: 400, height: 20 }, 'bottom', 'top'],
  [{ x: 0, y: 0, width: 100, height: 1000 }, { x: 110, y: 0, width: 100, height: 1 }, 'right', 'left'],
] as const)('#2540: accounts for both node dimensions without choosing a non-facing axis', (source, target, a, b) => {
  expect(closestFacingHandles(source, target)).toEqual({ sourceHandle: `source-${a}`, targetHandle: `target-${b}` });
});

it.each([
  [square, 'right', 'left'],
  [{ x: 50, y: 25, width: 100, height: 100 }, 'right', 'left'],
  [{ x: 40, y: 40, width: 20, height: 20 }, 'right', 'left'],
  [{ x: 0, y: 0, width: 0, height: 0 }, 'left', 'right'],
] as const)('#2540: overlapping and coincident bounds have a deterministic finite fallback', (target, a, b) => {
  const first = closestFacingHandles(Object.freeze(square), Object.freeze(target));
  expect(first).toEqual({ sourceHandle: `source-${a}`, targetHandle: `target-${b}` });
  expect(closestFacingHandles(square, target)).toEqual(first);
});

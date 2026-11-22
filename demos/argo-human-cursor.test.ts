// @module-tag dom
import { describe, expect, it } from 'vitest';
import { buildHumanCursorPath, movementDurationMs } from './argo-human-cursor';

describe('Argo human cursor movement', () => {
  it('builds a reproducible curved path with exact endpoints', () => {
    const from = { x: 40, y: 700 };
    const to = { x: 1300, y: 180 };
    const first = buildHumanCursorPath(from, to, 'tutorial-v7:1', 48);

    expect(first).toEqual(buildHumanCursorPath(from, to, 'tutorial-v7:1', 48));
    expect(first[0]).toEqual(from);
    expect(first.at(-1)).toEqual(to);
    expect(
      first
        .slice(1, -1)
        .some((point) => Math.abs((point.x - from.x) * (to.y - from.y) - (point.y - from.y) * (to.x - from.x)) > 100),
    ).toBe(true);
  });

  it('scales movement time by frame distance within tutorial limits', () => {
    const viewport = { x: 1920, y: 1080 };
    expect(movementDurationMs({ x: 100, y: 100 }, { x: 110, y: 110 }, viewport)).toBe(304);
    expect(movementDurationMs({ x: 0, y: 0 }, { x: 1920, y: 1080 }, viewport)).toBe(1000);
  });
});

// @module-tag dom
import { describe, expect, it } from 'vitest';
import { clampPipGeometry } from './pip-geometry';

// Mirrors the constants PipPlayer.tsx passes in (kept in sync deliberately —
// these are what actually ships, not arbitrary test fixtures).
const DESIRED = { width: 400, height: 250, margin: 32, minWidth: 280, minHeight: 180 };

describe('clampPipGeometry', () => {
  it('reproduces the previous fixed desktop geometry unchanged on a desktop-sized viewport', () => {
    const geometry = clampPipGeometry({ width: 1440, height: 900 }, DESIRED);

    // Matches the pre-fix formula: x = innerWidth - 432, y = innerHeight - 282.
    expect(geometry).toEqual({ x: 1008, y: 618, width: 400, height: 250 });
  });

  it('issue #860: keeps the entire player — including the close button — on screen at 375x667', () => {
    const geometry = clampPipGeometry({ width: 375, height: 667 }, DESIRED);

    // Left edge on screen (no negative x pushing the box off the left edge).
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    // Right edge (where the close button lives) on screen.
    expect(geometry.x + geometry.width).toBeLessThanOrEqual(375);
    // Top/bottom edges on screen too.
    expect(geometry.y).toBeGreaterThanOrEqual(0);
    expect(geometry.y + geometry.height).toBeLessThanOrEqual(667);
    // Width shrank to fit (400 desired doesn't fit a 375-wide viewport).
    expect(geometry.width).toBeLessThan(400);
    expect(geometry.width).toBeGreaterThanOrEqual(DESIRED.minWidth);
  });

  it('never shrinks narrower than the minWidth react-rnd itself enforces, down to a 320px phone', () => {
    const geometry = clampPipGeometry({ width: 320, height: 568 }, DESIRED);

    expect(geometry.width).toBeGreaterThanOrEqual(DESIRED.minWidth);
    expect(geometry.x + geometry.width).toBeLessThanOrEqual(320);
    expect(geometry.x).toBeGreaterThanOrEqual(0);
  });

  it('shrinks height by the same ratio as width so the player keeps its shape', () => {
    const geometry = clampPipGeometry({ width: 375, height: 667 }, DESIRED);

    const widthRatio = geometry.width / DESIRED.width;
    expect(geometry.height).toBeCloseTo(DESIRED.height * widthRatio, 0);
  });

  it('also caps height on a short (landscape phone) viewport', () => {
    const geometry = clampPipGeometry({ width: 700, height: 300 }, DESIRED);

    expect(geometry.height).toBeLessThanOrEqual(300 - DESIRED.margin * 2);
    expect(geometry.y).toBeGreaterThanOrEqual(0);
    expect(geometry.y + geometry.height).toBeLessThanOrEqual(300);
  });

  it('degrades gracefully below the documented 320px floor instead of producing negative geometry', () => {
    const geometry = clampPipGeometry({ width: 280, height: 500 }, DESIRED);

    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.width).toBeGreaterThan(0);
    expect(geometry.height).toBeGreaterThan(0);
  });
});

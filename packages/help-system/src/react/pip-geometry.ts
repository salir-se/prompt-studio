// Viewport-aware initial geometry for the PiP player (issue #860).
//
// The player used to mount at a fixed desktop-sized box (400x250, anchored
// 32px from the bottom-right corner) regardless of viewport. On a phone
// narrower than ~432px that pushed the box — and the close button in its
// header — partly or fully outside the visible viewport, with `bounds`
// only constraining *drags*, never the initial mount position. There was
// then no way to dismiss the player short of a page reload.
//
// `clampPipGeometry` is a pure function (no DOM reads) so the viewport-fitting
// math is unit-testable without mounting react-rnd.

export interface Viewport {
  width: number;
  height: number;
}

export interface PipDesiredGeometry {
  /** Desired (desktop) width in px. */
  width: number;
  /** Desired (desktop) height in px. */
  height: number;
  /** Breathing room to keep from every viewport edge, in px. */
  margin: number;
  /** Floor react-rnd itself refuses to shrink narrower than (its `minWidth` prop). */
  minWidth: number;
  /** Floor react-rnd itself refuses to shrink shorter than (its `minHeight` prop). */
  minHeight: number;
}

export interface PipGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Clamp the player's desired geometry to whatever fits inside `viewport`,
 * anchored to the same bottom-right corner the fixed desktop geometry used.
 * Width is capped to `viewport.width - margin * 2` (never below `minWidth` —
 * the same floor react-rnd enforces at render time via its own `minWidth`
 * prop, so the two stay consistent). Height shrinks by the same ratio as
 * width so the player keeps its shape instead of going unexpectedly
 * tall/thin, then is separately capped to the viewport's height. Position is
 * re-derived from the resulting size so both edges — including the header's
 * close button in the top-right corner — start fully on screen on any
 * viewport down to 320px wide. On a desktop-sized viewport this reproduces
 * the previous fixed geometry exactly.
 */
export function clampPipGeometry(viewport: Viewport, desired: PipDesiredGeometry): PipGeometry {
  const vw = Math.max(viewport.width, 0);
  const vh = Math.max(viewport.height, 0);

  const maxWidth = Math.max(vw - desired.margin * 2, desired.minWidth);
  const width = Math.min(desired.width, maxWidth);

  // Shrink height by the same ratio the width was shrunk, then apply its own
  // viewport cap (landscape phones constrain height more than width).
  const widthRatio = width / desired.width;
  const maxHeight = Math.max(vh - desired.margin * 2, desired.minHeight);
  const height = Math.min(desired.height * widthRatio, maxHeight);

  const x = Math.max(0, vw - desired.margin - width);
  const y = Math.max(0, vh - desired.margin - height);

  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

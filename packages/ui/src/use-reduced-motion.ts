/**
 * Tracks the user's `prefers-reduced-motion` OS/browser accessibility setting
 * reactively — subscribes to `matchMedia` changes so a mid-session toggle is
 * picked up without a remount. SSR-safe: falls back to `false` (motion
 * allowed) when `window`/`matchMedia` is unavailable.
 *
 * Introduced for ScoreGauge's mount-sweep animation (issue #898) — the app's
 * first deliberate animation. Lives in `lib/` (same pattern as
 * `use-signup-route.ts`) so any future animated component can reuse it
 * without re-deriving the matchMedia plumbing.
 */

import { useSyncExternalStore } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, readPrefersReducedMotion, readPrefersReducedMotion);
}

// @module-tag dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsMobile } from './useIsMobile';

/**
 * Install a controllable `matchMedia`. `matches` is computed from a shared,
 * mutable `width` (via a getter) so a viewport change is observable through the
 * same MediaQueryList the hook captured in its effect.
 */
function stubMatchMedia(initialWidth: number) {
  let width = initialWidth;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = Number(query.match(/max-width:\s*(\d+)px/)?.[1] ?? Number.POSITIVE_INFINITY);
    return {
      get matches() {
        return width <= max;
      },
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      addListener: (cb: () => void) => listeners.add(cb),
      removeListener: (cb: () => void) => listeners.delete(cb),
    } as unknown as MediaQueryList;
  });
  return {
    resize: (w: number) => {
      width = w;
      for (const cb of listeners) cb();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useIsMobile', () => {
  it('is true when the viewport is at or below the breakpoint', () => {
    stubMatchMedia(375);
    const { result } = renderHook(() => useIsMobile(640));
    expect(result.current).toBe(true);
  });

  it('is false on a wide viewport', () => {
    stubMatchMedia(1280);
    const { result } = renderHook(() => useIsMobile(640));
    expect(result.current).toBe(false);
  });

  it('reacts to a viewport change', () => {
    const screen = stubMatchMedia(1280);
    const { result } = renderHook(() => useIsMobile(640));
    expect(result.current).toBe(false);
    act(() => screen.resize(375));
    expect(result.current).toBe(true);
  });

  it('defaults to desktop when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useIsMobile(640));
    expect(result.current).toBe(false);
  });
});

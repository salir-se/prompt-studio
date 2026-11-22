// @module-tag dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFirstVisitAutoOpen } from './useFirstVisitAutoOpen';

function makeStore(seen: boolean) {
  return {
    hasSeen: vi.fn().mockResolvedValue(seen),
    markSeen: vi.fn().mockResolvedValue(undefined),
  };
}

describe('useFirstVisitAutoOpen', () => {
  it('auto-opens and marks the page seen on a first visit', async () => {
    const store = makeStore(false);
    const onAutoOpen = vi.fn();

    renderHook(() => useFirstVisitAutoOpen({ pageKey: 'dashboard', store, onAutoOpen }));
    await act(async () => {});

    expect(onAutoOpen).toHaveBeenCalledTimes(1);
    expect(store.markSeen).toHaveBeenCalledWith('dashboard');
  });

  it('does not auto-open when the page was already seen', async () => {
    const store = makeStore(true);
    const onAutoOpen = vi.fn();

    renderHook(() => useFirstVisitAutoOpen({ pageKey: 'dashboard', store, onAutoOpen }));
    await act(async () => {});

    expect(onAutoOpen).not.toHaveBeenCalled();
    expect(store.markSeen).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    const store = makeStore(false);
    const onAutoOpen = vi.fn();

    renderHook(() => useFirstVisitAutoOpen({ pageKey: 'dashboard', enabled: false, store, onAutoOpen }));
    await act(async () => {});

    expect(store.hasSeen).not.toHaveBeenCalled();
    expect(store.markSeen).not.toHaveBeenCalled();
    expect(onAutoOpen).not.toHaveBeenCalled();
  });

  it('does not auto-open after unmount races the seen check', async () => {
    const store = makeStore(false);
    const onAutoOpen = vi.fn();

    const { unmount } = renderHook(() => useFirstVisitAutoOpen({ pageKey: 'dashboard', store, onAutoOpen }));
    unmount();
    await act(async () => {});

    expect(onAutoOpen).not.toHaveBeenCalled();
  });
});

// @module-tag dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInactivityTimeout } from './useInactivityTimeout';

describe('useInactivityTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onTimeout after the idle period when active', () => {
    const onTimeout = vi.fn();
    renderHook(() => useInactivityTimeout({ timeoutMs: 1000, active: true, onTimeout }));

    act(() => vi.advanceTimersByTime(1000));

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('resets the countdown on notifyActivity', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useInactivityTimeout({ timeoutMs: 1000, active: true, onTimeout }));

    act(() => vi.advanceTimersByTime(999));
    act(() => result.current.notifyActivity());
    act(() => vi.advanceTimersByTime(999));
    expect(onTimeout).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('never fires while inactive', () => {
    const onTimeout = vi.fn();
    renderHook(() => useInactivityTimeout({ timeoutMs: 1000, active: false, onTimeout }));

    act(() => vi.advanceTimersByTime(10_000));

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('never fires when the timeout is disabled', () => {
    const onTimeout = vi.fn();
    renderHook(() => useInactivityTimeout({ timeoutMs: false, active: true, onTimeout }));

    act(() => vi.advanceTimersByTime(10_000));

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('stops the timer when active flips to false', () => {
    const onTimeout = vi.fn();
    const { rerender } = renderHook(({ active }) => useInactivityTimeout({ timeoutMs: 1000, active, onTimeout }), {
      initialProps: { active: true },
    });

    act(() => vi.advanceTimersByTime(500));
    rerender({ active: false });
    act(() => vi.advanceTimersByTime(1000));

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('clears the timer on unmount', () => {
    const onTimeout = vi.fn();
    const { unmount } = renderHook(() => useInactivityTimeout({ timeoutMs: 1000, active: true, onTimeout }));

    unmount();
    act(() => vi.advanceTimersByTime(1000));

    expect(onTimeout).not.toHaveBeenCalled();
  });
});

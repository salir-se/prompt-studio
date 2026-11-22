// @module-tag pure
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestLifetime } from './request-lifetime';

describe('requestLifetime fallback', () => {
  const originalAny = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!;

  afterEach(() => {
    Object.defineProperty(AbortSignal, 'any', originalAny);
    vi.restoreAllMocks();
  });

  it('preserves caller cancellation when AbortSignal.any is unavailable', () => {
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
    const caller = new AbortController();
    const reason = new Error('caller stopped');

    const lifetime = requestLifetime(60_000, caller.signal);
    caller.abort(reason);

    expect(lifetime.signal.aborted).toBe(true);
    expect(lifetime.signal.reason).toBe(reason);
  });

  it('preserves timeout cancellation when AbortSignal.any is unavailable', () => {
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
    const timeout = new AbortController();
    const reason = new DOMException('timed out', 'TimeoutError');
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);

    const lifetime = requestLifetime(10, new AbortController().signal);
    timeout.abort(reason);

    expect(lifetime.signal.aborted).toBe(true);
    expect(lifetime.signal.reason).toBe(reason);
  });

  it('removes fallback listeners as soon as a request completes normally', async () => {
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
    const caller = new AbortController();
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const removeCaller = vi.spyOn(caller.signal, 'removeEventListener');
    const removeTimeout = vi.spyOn(timeout.signal, 'removeEventListener');

    const lifetime = requestLifetime(60_000, caller.signal);
    try {
      await Promise.resolve('complete');
    } finally {
      lifetime.dispose();
    }

    expect(removeCaller).toHaveBeenCalledOnce();
    expect(removeTimeout).toHaveBeenCalledOnce();
    expect(lifetime.signal.aborted).toBe(false);
  });
});

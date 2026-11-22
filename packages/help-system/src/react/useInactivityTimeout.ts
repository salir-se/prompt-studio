import { useCallback, useEffect, useRef } from 'react';

/** Options for {@link useInactivityTimeout} — collapse the help panel after idle (ADR-089). */
export interface UseInactivityTimeoutOptions {
  /** Idle period before firing. `false` disables the timeout. */
  timeoutMs: number | false;
  /** Only count down while true (e.g. the panel is open). */
  active: boolean;
  onTimeout: () => void;
}

export interface InactivityController {
  /** Reset the idle timer (call on any panel interaction). */
  notifyActivity: () => void;
}

/**
 * Fires `onTimeout` after `timeoutMs` of inactivity while `active` is true —
 * used to auto-collapse an idle help panel. `notifyActivity` resets the countdown
 * on each interaction; the timer is cleared when the panel goes inactive, when
 * the timeout is disabled (`false`), or on unmount. `onTimeout` is read through a
 * ref so a changing callback identity does not restart the timer.
 */
export function useInactivityTimeout(options: UseInactivityTimeoutOptions): InactivityController {
  const { timeoutMs, active, onTimeout } = options;

  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clear();
    if (!active || timeoutMs === false) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onTimeoutRef.current();
    }, timeoutMs);
  }, [active, timeoutMs, clear]);

  const notifyActivity = useCallback(() => {
    start();
  }, [start]);

  useEffect(() => {
    start();
    return clear;
  }, [start, clear]);

  return { notifyActivity };
}

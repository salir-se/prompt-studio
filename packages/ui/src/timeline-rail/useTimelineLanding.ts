import { useCallback, useEffect, useRef } from 'react';
import { MOTION } from '../motion';
import type { TimelineNavigationItem } from './TimelineNavigator';
import { flashLanding } from './timeline-rail-landing';

/**
 * Landing flash for a rail jump. `expectLanding(item)` is called when a jump starts; the flash runs when the
 * spy releases the hold (`held` goes false), i.e. when the scroll has landed. Boundaries are 0px tall and never
 * flash. `enabled` is the `animate` prop only: under `prefers-reduced-motion` the flash stays as a short fade.
 */
export function useTimelineLanding({
  enabled,
  reducedMotion,
  held,
}: {
  enabled: boolean;
  reducedMotion: boolean;
  held: boolean;
}): (item: TimelineNavigationItem) => void {
  const pending = useRef<TimelineNavigationItem | null>(null);
  const stop = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (held) return;
    const item = pending.current;
    pending.current = null;
    const target = item ? document.getElementById(item.targetId) : null;
    if (!enabled || !target) return;
    stop.current?.();
    stop.current = flashLanding(target, reducedMotion ? MOTION.reduced.fadeMs : undefined);
  }, [held, enabled, reducedMotion]);

  useEffect(() => () => stop.current?.(), []);

  return useCallback((item: TimelineNavigationItem) => {
    pending.current = item.kind === 'boundary' ? null : item;
  }, []);
}

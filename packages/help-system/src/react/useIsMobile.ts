import { useEffect, useState } from 'react';

/**
 * Tracks whether the viewport is at or below `maxWidth` (default 640px), so the
 * help panel can render as a bottom-sheet on phones instead of a side panel
 * (ADR-089 §G12). SSR/`matchMedia`-less environments default to `false` (desktop).
 */
export function useIsMobile(maxWidth = 640): boolean {
  const query = `(max-width: ${maxWidth}px)`;

  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    // `addEventListener` is the modern API; older Safari only has `addListener`.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return isMobile;
}

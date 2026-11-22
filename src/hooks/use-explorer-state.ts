import { useState, useSyncExternalStore } from 'react';

const query = '(max-width: 767px)';
function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
function isNarrow() {
  return window.matchMedia(query).matches;
}

/** Only layout visibility lives here; browsing never owns or discards document edits. */
export function useExplorerState() {
  const drawer = useSyncExternalStore(subscribe, isNarrow, () => false);
  const [preference, setPreference] = useState<{ open: boolean; drawer: boolean } | null>(null);
  // A dock preference must not become a covering drawer when the window narrows.
  const open = preference?.drawer === drawer ? preference.open : !drawer;
  return {
    open,
    drawer,
    toggle: () => setPreference({ open: !open, drawer }),
    close: () => setPreference({ open: false, drawer }),
    reset: () => setPreference(null),
  };
}

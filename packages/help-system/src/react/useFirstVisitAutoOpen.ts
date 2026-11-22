import { useEffect, useRef } from 'react';

/** Options for {@link useFirstVisitAutoOpen} — auto-open the help panel once per page (ADR-089). */
export interface UseFirstVisitAutoOpenOptions {
  pageKey: string;
  /** Default true. */
  enabled?: boolean;
  /** Read-only async persistence of per-page "seen" flags. Structurally matches HelpHistoryStore. */
  store: { hasSeen(pageKey: string): Promise<boolean>; markSeen(pageKey: string): Promise<void> };
  /** Called once, the first time this user lands on `pageKey`. */
  onAutoOpen: () => void;
}

/**
 * Opens the help panel automatically the first time the user lands on a given
 * page, then records the visit so it never auto-opens there again. The "seen"
 * check is async (the store may be IndexedDB-backed, ADR-045), so the effect
 * guards against a double-fire within a mount and against an unmount/await race
 * resolving after teardown. `onAutoOpen` is read through a ref so a changing
 * callback identity does not re-run the check.
 */
export function useFirstVisitAutoOpen(options: UseFirstVisitAutoOpenOptions): void {
  const { pageKey, enabled = true, store, onAutoOpen } = options;

  const onAutoOpenRef = useRef(onAutoOpen);
  onAutoOpenRef.current = onAutoOpen;

  // Read through a ref so a fresh inline `store` object does not re-run the
  // effect (which is keyed only on the page + enable flag).
  const storeRef = useRef(store);
  storeRef.current = store;

  // pageKeys already handled this mount — guards against re-checking when the
  // effect re-runs (e.g. StrictMode double-invoke) for the same page.
  const handledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    if (handledRef.current.has(pageKey)) return;
    handledRef.current.add(pageKey);

    let cancelled = false;
    void (async () => {
      const seen = await storeRef.current.hasSeen(pageKey);
      // The component may have unmounted (or the effect re-run) while awaiting.
      if (cancelled || seen) return;
      onAutoOpenRef.current();
      await storeRef.current.markSeen(pageKey);
    })();

    return () => {
      cancelled = true;
    };
  }, [pageKey, enabled]);
}

/**
 * useRemoteHelpContent — flag-gated runtime fetch of CMS-managed FAQ content
 * (ADR-095), merged into the bundled `HelpContent`.
 *
 * Safe-fallback by construction: the hook returns `base` synchronously and
 * only ever upgrades to the merged registry after a successful fetch +
 * validation. Any failure — network, non-200, malformed payload — keeps the
 * bundled content and warns once. Host-agnostic: plain fetch + sessionStorage,
 * no query library (this package is consumed by app, console, and future
 * surfaces with different data stacks).
 *
 * Caching: the validated payload is kept in sessionStorage
 * (`salir:help-cms:<surface>`) for warm starts; a refetch happens once per
 * mount when the cached copy is older than `cacheTtlMs` (default 5 minutes —
 * aligned with the server's 300s read-through cache).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { mergeHelpContent, parseRemoteHelpPayload, type RemoteHelpPayload } from '../core/remoteContent';
import type { HelpContent } from '../core/types';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

export interface UseRemoteHelpContentOptions {
  /** The bundled (compile-time) content — always the fallback. */
  base: HelpContent;
  /** Surface identifier ('app' | 'console' | 'booking' | …). */
  surface: string;
  /** Absolute URL of `GET /api/help/content/:surface`. Empty = disabled. */
  endpoint: string;
  /** The `help-cms-content` flag (resolved by the host). */
  enabled: boolean;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
}

interface CacheEntry {
  payload: RemoteHelpPayload;
  fetchedAt: number;
}

function storageKey(surface: string): string {
  return `salir:help-cms:${surface}`;
}

function readCache(surface: string): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(storageKey(surface));
    if (!raw) return null;
    const entry = JSON.parse(raw) as { payload?: unknown; fetchedAt?: unknown };
    const payload = parseRemoteHelpPayload(entry.payload);
    if (!payload || typeof entry.fetchedAt !== 'number') return null;
    return { payload, fetchedAt: entry.fetchedAt };
  } catch {
    return null;
  }
}

function writeCache(surface: string, entry: CacheEntry): void {
  try {
    sessionStorage.setItem(storageKey(surface), JSON.stringify(entry));
  } catch {
    /* quota/privacy mode — cache is best-effort */
  }
}

export function useRemoteHelpContent({
  base,
  surface,
  endpoint,
  enabled,
  fetchImpl,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
}: UseRemoteHelpContentOptions): HelpContent {
  const active = enabled && endpoint !== '';
  // Warm-start from sessionStorage so a tab navigation doesn't flash bundled
  // content while the refetch is in flight.
  const [payload, setPayload] = useState<RemoteHelpPayload | null>(() =>
    active ? (readCache(surface)?.payload ?? null) : null,
  );
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!active || fetchedRef.current) return;
    fetchedRef.current = true;
    const cached = readCache(surface);
    if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
      setPayload(cached.payload);
      return;
    }
    const doFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (!doFetch) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await doFetch(endpoint);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const parsed = parseRemoteHelpPayload(await res.json());
        if (!parsed) throw new Error('malformed help content payload');
        if (cancelled) return;
        setPayload(parsed);
        writeCache(surface, { payload: parsed, fetchedAt: Date.now() });
      } catch (err) {
        // Safe fallback: bundled content stays in effect. One warn, no retry
        // storm — the next mount (or TTL expiry) tries again.
        console.warn(`[help-cms] remote content unavailable for "${surface}"; using bundled content`, err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, surface, endpoint, cacheTtlMs, fetchImpl]);

  return useMemo(() => {
    if (!active || !payload) return base;
    try {
      return mergeHelpContent(base, payload);
    } catch (err) {
      console.warn(`[help-cms] merge failed for "${surface}"; using bundled content`, err);
      return base;
    }
  }, [active, payload, base, surface]);
}

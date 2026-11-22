/**
 * Persistent storage subscriber for `policy:decided` events.
 *
 * Subscribes to the EventBus, batches incoming decisions (debounce 200ms,
 * max batch 50), and writes them via an injected store interface. Also
 * exposes a startup-time retention sweep that trims entries older than
 * the configured cutoff.
 *
 * The store interface (`PolicyDecisionStore`) is intentionally small so
 * any backing adapter — IndexedDB, localStorage, a mock — can satisfy it
 * without dragging `@prompt-studio/storage` into `@prompt-studio/observability`'s
 * runtime dependencies.
 *
 * See ADR-079 §"The event" + §"Retention".
 */

import type { PolicyDecisionShape } from './policy-recorder';
import type { PolicyDecision } from './policy-types';

/**
 * Minimal subscriber contract — what the store wires off any event bus
 * to listen for `policy:decided`. Uses the widened `PolicyDecisionShape`
 * (see `policy-recorder.ts`) so it stays structurally compatible with
 * `@prompt-studio/events` `EventBus` without forcing observability to depend on
 * the events package at runtime. Casts back to the strict `PolicyDecision`
 * happen inside the subscriber body.
 */
export interface PolicyEventSubscriber {
  on(event: 'policy:decided', handler: (payload: { decision: PolicyDecisionShape }) => void): () => void;
}

export interface PolicyDecisionStore {
  /** Append one or more decisions to durable storage. */
  appendDecisions(decisions: PolicyDecision[]): Promise<void>;
  /** Return all decisions matching the given filter, newest-first. */
  listDecisions(filter?: ListDecisionsFilter): Promise<PolicyDecision[]>;
  /** Remove decisions whose `timestamp` is older than the given ISO cutoff.
   *  Returns the number of entries removed. */
  trimOlderThan(cutoffIso: string): Promise<number>;
}

export interface ListDecisionsFilter {
  policy?: PolicyDecision['policy'];
  entityKind?: PolicyDecision['entityRef']['kind'];
  entityId?: string;
  traceId?: string;
  workspaceId?: string;
  /** Inclusive ISO timestamp lower bound. */
  since?: string;
  /** Maximum entries to return; default 100. */
  limit?: number;
}

export interface PolicyStoreSubscriberOptions {
  /** Debounce window for the batch flush (ms). Default 200. */
  flushDebounceMs?: number;
  /** Maximum batch size before forced flush. Default 50. */
  maxBatchSize?: number;
  /** Error sink — called when `appendDecisions` rejects so the storage
   *  failure shows up somewhere instead of being swallowed. */
  onError?: (err: unknown) => void;
}

export interface PolicyStoreSubscriber {
  /** Force an immediate flush of any pending decisions. */
  flush(): Promise<void>;
  /** Unsubscribe from the bus and reject any pending decisions. */
  dispose(): void;
  /** Sweep entries older than `retentionDays` days from now. Returns
   *  the number trimmed. */
  trim(retentionDays: number): Promise<number>;
}

/**
 * Wire up the storage subscriber. Returns a handle the caller uses for
 * shutdown / manual flush / retention sweeps.
 */
export function subscribePolicyDecisionsToStore(
  bus: PolicyEventSubscriber,
  store: PolicyDecisionStore,
  options: PolicyStoreSubscriberOptions = {},
): PolicyStoreSubscriber {
  const flushDebounceMs = options.flushDebounceMs ?? 200;
  const maxBatchSize = options.maxBatchSize ?? 50;
  const onError = options.onError ?? ((err) => console.error('[policy-store] append failed:', err));

  let pending: PolicyDecision[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      await store.appendDecisions(batch);
    } catch (err) {
      onError(err);
    }
  }

  function scheduleFlush(): void {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, flushDebounceMs);
  }

  const unsubscribe = bus.on('policy:decided', (payload) => {
    if (disposed) return;
    pending.push(payload.decision as PolicyDecision);
    if (pending.length >= maxBatchSize) {
      void flush();
      return;
    }
    scheduleFlush();
  });

  return {
    flush,
    dispose() {
      disposed = true;
      unsubscribe();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = [];
    },
    async trim(retentionDays: number): Promise<number> {
      const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      const cutoffIso = new Date(cutoffMs).toISOString();
      return store.trimOlderThan(cutoffIso);
    },
  };
}

/**
 * Shared filter/sort/limit semantics for `listDecisions()`. Exported so
 * every `PolicyDecisionStore` implementation applies IDENTICAL matching
 * rules regardless of how it fetched its candidate rows — the in-memory
 * store filters the whole array, the IndexedDB-backed store
 * (`policy-store-indexeddb.ts`) narrows via a Dexie index first and then
 * applies this same predicate to the (already-narrower) result set.
 */
export function applyListDecisionsFilter(
  entries: PolicyDecision[],
  filter: ListDecisionsFilter = {},
): PolicyDecision[] {
  const filtered = entries.filter((d) => {
    if (filter.policy && d.policy !== filter.policy) return false;
    if (filter.entityKind && d.entityRef.kind !== filter.entityKind) return false;
    if (filter.entityId && d.entityRef.id !== filter.entityId) return false;
    if (filter.traceId && d.traceId !== filter.traceId) return false;
    if (filter.workspaceId && d.workspaceId !== filter.workspaceId) return false;
    if (filter.since && d.timestamp < filter.since) return false;
    return true;
  });
  filtered.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return filtered.slice(0, filter.limit ?? 100);
}

/**
 * In-memory `PolicyDecisionStore` — used by tests, the dev debug drawer,
 * and as the default for cases where no persistent storage is wired yet.
 * Decisions are kept in a single array, sorted by `timestamp` descending
 * on read.
 */
export function createInMemoryPolicyDecisionStore(): PolicyDecisionStore & {
  /** Inspect the raw entries (test-only). */
  readonly entries: PolicyDecision[];
} {
  const entries: PolicyDecision[] = [];

  return {
    get entries() {
      return entries;
    },
    async appendDecisions(decisions: PolicyDecision[]): Promise<void> {
      for (const d of decisions) entries.push(d);
    },
    async listDecisions(filter: ListDecisionsFilter = {}): Promise<PolicyDecision[]> {
      return applyListDecisionsFilter(entries, filter);
    },
    async trimOlderThan(cutoffIso: string): Promise<number> {
      let trimmed = 0;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].timestamp < cutoffIso) {
          entries.splice(i, 1);
          trimmed++;
        }
      }
      return trimmed;
    },
  };
}

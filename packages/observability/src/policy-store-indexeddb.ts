/**
 * IndexedDB-backed `PolicyDecisionStore` (ADR-079, persistence phase —
 * issue #179 T1).
 *
 * ARCHITECTURE: mirrors `@prompt-studio/queue`'s `QueueEngine`/`QueueDB` pattern
 * (`packages/queue/src/schema.ts`, `packages/queue/src/engine.ts`) — this
 * package owns a small, dedicated Dexie database with a direct `dexie`
 * dependency. It NEVER imports `@prompt-studio/storage`: `@prompt-studio/storage` already
 * depends on `@prompt-studio/observability` (for logging + masking), so importing
 * back would create a package dependency cycle. Same reasoning `@prompt-studio/queue`
 * already applies for its own IndexedDB-backed job queue.
 *
 * Satisfies the existing `PolicyDecisionStore` interface from
 * `policy-store.ts` unchanged — `createPolicyRecorder()`,
 * `subscribePolicyDecisionsToStore()`, and every call site keep working
 * whether the backing store is this one or the in-memory fallback.
 *
 * ADR-079 explicitly keeps policy decisions LOCAL-ONLY even for `turso`
 * workspaces ("Turso schema migration is deferred to Phase 7") — there is
 * NO `adapterMode` branching here and none should be added without a new
 * ADR decision.
 */

// `dexie` is loaded LAZILY (dynamic import at first store use), never at
// module load. This file is re-exported from the package barrel, and the
// barrel is imported by every logging/masking consumer across workers and
// the SPA — an eager `import Dexie` here would make dexie load (and snapshot
// `globalThis.indexedDB`, see the note below) as a side effect of importing
// `@prompt-studio/observability` for a logger. That exact side effect broke
// `www/app.salir.se`'s queue integration tests: their `fake-indexeddb/auto`
// first-line import ran AFTER a setup-chain barrel import had already let
// dexie capture `indexedDB === undefined`. Type-only imports are erased at
// compile time and carry no runtime load.
import type { Dexie, EntityTable, Table } from 'dexie';
import type { ListDecisionsFilter, PolicyDecisionStore } from './policy-store';
import { applyListDecisionsFilter, createInMemoryPolicyDecisionStore } from './policy-store';
import { createPolicyDecisionsBroadcast, type PolicyDecisionsBroadcast } from './policy-store-indexeddb-broadcast';
import type { PolicyDecision } from './policy-types';

type DexieModule = typeof import('dexie');

let dexieModulePromise: Promise<DexieModule> | null = null;

/** Load `dexie` exactly once, on first use — never as a barrel side effect. */
function loadDexie(): Promise<DexieModule> {
  dexieModulePromise ??= import('dexie');
  return dexieModulePromise;
}

/** Production database name. Tests override via `dbName` for isolation,
 *  same convention `QueueDB`/`QueueEngine` use. */
const DB_NAME = 'salir-policy-decisions';

/** Dexie's `indexedDB`/`IDBKeyRange` dependency pair. Dexie resolves these
 *  from `globalThis` exactly ONCE, in a module-level `try {}` block the
 *  moment `dexie` is first imported — NOT dynamically per `new Dexie(...)`
 *  call. That means mutating `globalThis.indexedDB` later (e.g. a test's
 *  `beforeEach`, after `dexie` has already been imported at file top-level)
 *  has no effect on Dexie's already-captured snapshot. Threading an
 *  explicit pair through the constructor (Dexie's own `DexieOptions`
 *  support this) sidesteps that entirely — tests inject a fresh
 *  `fake-indexeddb` factory directly instead of racing module load order. */
type DexieIndexedDBDeps = { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange };

/** The lazily-constructed database plus the module statics the queries need
 *  (`minKey`/`maxKey` live on the Dexie constructor, not instances). */
type PolicyDb = { db: Dexie & { decisions: EntityTable<PolicyDecision, 'id'> }; DexieCtor: DexieModule['default'] };

/** Construct the database. The subclass is defined here — inside the
 *  post-import factory — because `class ... extends Dexie` needs the runtime
 *  constructor, which this module deliberately does not load until now.
 *
 *  v1: `id` is the primary key. Compound indexes cover the three read
 *  patterns the issue calls for — per-workspace-and-time (the Activity
 *  view's default sort), per-workspace-and-entity (the "Why?" popover /
 *  per-lead Decisions tab), and per-workspace-and-trace (grouping one
 *  agent run's decisions together). Dexie supports dot-path indexing into a
 *  nested field, so `entityRef.id` does not need to be hoisted to a
 *  top-level column. */
async function openPolicyDb(dbName: string = DB_NAME, deps?: DexieIndexedDBDeps): Promise<PolicyDb> {
  const mod = await loadDexie();
  const DexieCtor = mod.default;
  class PolicyDecisionsDB extends DexieCtor {
    decisions!: Table<PolicyDecision, string>;

    constructor() {
      super(dbName, deps ? { indexedDB: deps.indexedDB, IDBKeyRange: deps.IDBKeyRange } : undefined);
      this.version(1).stores({
        decisions: 'id, [workspaceId+timestamp], [workspaceId+entityRef.id], [workspaceId+traceId]',
      });
    }
  }
  return { db: new PolicyDecisionsDB() as PolicyDb['db'], DexieCtor };
}

/** Feature-detect IndexedDB availability — mirrors
 *  `packages/storage/src/adapters/index.ts#supportsIndexedDB`. Not
 *  available in some private-browsing modes, SSR, and (deliberately, in
 *  this repo's default test environment) plain Node vitest runs that
 *  don't opt into `fake-indexeddb`. */
export function supportsIndexedDB(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

export interface IndexedDBPolicyDecisionStoreOptions {
  /** Override the IndexedDB database name for test isolation. Production
   *  omits this and every caller shares the single default database — the
   *  same "one collection" shape ADR-079 specifies, not one DB per
   *  workspace (workspace scoping happens via the indexed `workspaceId`
   *  field on each row, same as `@prompt-studio/queue`'s `[workspaceId+...]`
   *  indexes). */
  dbName?: string;
  /** Inject a broadcast handle (or `null` to disable cross-tab
   *  notification entirely) — primarily for test isolation. Defaults to a
   *  real `BroadcastChannel`-backed instance on the shared channel. */
  broadcast?: PolicyDecisionsBroadcast | null;
  /** Override Dexie's `indexedDB` factory (paired with `idbKeyRange`) for
   *  this store instance — see the `DexieIndexedDBDeps` note above. Tests
   *  pass a fresh `fake-indexeddb` `IDBFactory` + its `IDBKeyRange` here
   *  instead of mutating `globalThis`. Both must be supplied together;
   *  omitting either falls back to whatever `dexie` itself resolved from
   *  `globalThis` at its own module-load time. */
  indexedDB?: IDBFactory;
  idbKeyRange?: typeof IDBKeyRange;
}

/**
 * Create a `PolicyDecisionStore` backed directly by IndexedDB via Dexie.
 * Throws only if IndexedDB itself throws (a genuinely broken environment);
 * callers that want automatic feature-detected fallback should use
 * {@link createPersistentPolicyDecisionStore} instead.
 */
export function createIndexedDBPolicyDecisionStore(
  options: IndexedDBPolicyDecisionStoreOptions = {},
): PolicyDecisionStore {
  const deps =
    options.indexedDB && options.idbKeyRange
      ? { indexedDB: options.indexedDB, IDBKeyRange: options.idbKeyRange }
      : undefined;
  // Lazy: dexie loads and the database opens on the FIRST store operation,
  // not at factory-call time — keeping both this factory and the package
  // barrel synchronous and side-effect-free.
  let dbPromise: Promise<PolicyDb> | null = null;
  const getDb = (): Promise<PolicyDb> => {
    dbPromise ??= openPolicyDb(options.dbName, deps);
    return dbPromise;
  };
  const broadcast = options.broadcast === null ? null : (options.broadcast ?? createPolicyDecisionsBroadcast());

  function notifyByWorkspace(
    type: 'policy-decisions:appended' | 'policy-decisions:trimmed',
    decisions: Array<Pick<PolicyDecision, 'workspaceId'>>,
  ): void {
    if (!broadcast || decisions.length === 0) return;
    const counts = new Map<string, number>();
    for (const { workspaceId } of decisions) {
      counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + 1);
    }
    for (const [workspaceId, count] of counts) {
      broadcast.notify({ type, workspaceId, count });
    }
  }

  return {
    async appendDecisions(decisions: PolicyDecision[]): Promise<void> {
      if (decisions.length === 0) return;
      const { db } = await getDb();
      // `bulkPut` (not `bulkAdd`) so a defensive re-append of a decision
      // that already made it to disk (e.g. a retried batch) upserts
      // instead of throwing ConstraintError — decision `id`s are unique
      // ulids generated by the recorder, so this is idempotent in the
      // normal case and merely tolerant in the retry case.
      await db.decisions.bulkPut(decisions);
      notifyByWorkspace('policy-decisions:appended', decisions);
    },

    async listDecisions(filter: ListDecisionsFilter = {}): Promise<PolicyDecision[]> {
      const { db, DexieCtor } = await getDb();
      let entries: PolicyDecision[];
      if (filter.workspaceId && filter.entityId) {
        entries = await db.decisions
          .where('[workspaceId+entityRef.id]')
          .equals([filter.workspaceId, filter.entityId])
          .toArray();
      } else if (filter.workspaceId && filter.traceId) {
        entries = await db.decisions
          .where('[workspaceId+traceId]')
          .equals([filter.workspaceId, filter.traceId])
          .toArray();
      } else if (filter.workspaceId) {
        entries = await db.decisions
          .where('[workspaceId+timestamp]')
          .between([filter.workspaceId, DexieCtor.minKey], [filter.workspaceId, DexieCtor.maxKey])
          .toArray();
      } else {
        entries = await db.decisions.toArray();
      }
      return applyListDecisionsFilter(entries, filter);
    },

    async trimOlderThan(cutoffIso: string): Promise<number> {
      const { db } = await getDb();
      const stale = await db.decisions.filter((d) => d.timestamp < cutoffIso).toArray();
      if (stale.length === 0) return 0;
      await db.decisions.bulkDelete(stale.map((d) => d.id));
      notifyByWorkspace('policy-decisions:trimmed', stale);
      return stale.length;
    },
  };
}

/**
 * Feature-detected factory: uses the real IndexedDB-backed store when
 * available, otherwise falls back to `createInMemoryPolicyDecisionStore()`
 * — same shape `createStorageAdapter`'s localStorage fallback uses
 * (`packages/storage/src/adapters/index.ts`). This is the entry point
 * `@prompt-studio/engine`'s composition root calls; individual tests that want to
 * exercise the real Dexie path directly should call
 * {@link createIndexedDBPolicyDecisionStore} instead.
 *
 * An explicit `indexedDB`/`idbKeyRange` override (both supplied) skips the
 * `globalThis` feature-detection entirely and goes straight to the real
 * store — this is what lets a test inject a fresh `fake-indexeddb`
 * instance without needing `globalThis.indexedDB` to already be truthy.
 */
export function createPersistentPolicyDecisionStore(
  options: IndexedDBPolicyDecisionStoreOptions = {},
): PolicyDecisionStore {
  const hasExplicitDeps = Boolean(options.indexedDB && options.idbKeyRange);
  if (!hasExplicitDeps && !supportsIndexedDB()) return createInMemoryPolicyDecisionStore();
  return createIndexedDBPolicyDecisionStore(options);
}

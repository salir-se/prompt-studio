/**
 * Snapshot persistence for the history providers (ADR-203 decision 4): a provider serializes its FULL
 * state to one string under one versioned key, and boot restores it. The store is a CACHE — if it is
 * missing, corrupt, or the environment has no IndexedDB, the studio re-seeds from the shipped
 * constants, losing nothing but history. That is why EVERY failure path here resolves (`null` /
 * no-op) with a `console.warn` naming the operation instead of throwing: a dev tool must not crash
 * on a broken cache.
 *
 * Two implementations:
 *  - `MemorySnapshotStore` — a `Map`; the test double and the "no persistence" mode.
 *  - `IndexedDbSnapshotStore` — plain `indexedDB` API (no wrapper dependency), chosen over
 *    localStorage because history grows (ADR-203 decision 4; ADR-045 precedent).
 */

/** Minimal async key→string persistence a `HistoryProvider` snapshots through. */
export interface SnapshotStore {
  /** The stored value for `key`, or `null` when absent or the store is unavailable/broken. */
  load(key: string): Promise<string | null>;
  /** Stores `value` under `key`. Best-effort: a broken store warns and resolves, never throws. */
  save(key: string, value: string): Promise<void>;
}

/** In-memory `SnapshotStore` — deterministic test double; also usable as an explicit no-persistence mode. */
export class MemorySnapshotStore implements SnapshotStore {
  private readonly entries = new Map<string, string>();

  load(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  save(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
    return Promise.resolve();
  }
}

/** One database, one object store — the whole schema. Bump `DB_VERSION` only with an upgrade path. */
const DB_NAME = 'prompt-studio-history';
const OBJECT_STORE_NAME = 'snapshots';
const DB_VERSION = 1;

/** Every failure path funnels through here so the console names the operation that hit the broken cache. */
function warnSnapshotFailure(operation: string, detail: unknown): void {
  console.warn(`[prompt-studio] history snapshot ${operation} failed — treating the cache as absent`, detail);
}

/**
 * IndexedDB-backed `SnapshotStore` over the plain `indexedDB` API. Opens the database per call
 * (open is cheap after first creation, and holding no connection avoids blocking future upgrades).
 * All failures — no `indexedDB` global, open/transaction/request errors, thrown DOM exceptions —
 * degrade to `null`/no-op with a named `console.warn`; nothing here ever rejects.
 */
export class IndexedDbSnapshotStore implements SnapshotStore {
  load(key: string): Promise<string | null> {
    return this.withStore('load', 'readonly', (store, resolve) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
      request.onerror = () => {
        warnSnapshotFailure('load', request.error);
        resolve(null);
      };
    }).then((value) => value ?? null);
  }

  async save(key: string, value: string): Promise<void> {
    await this.withStore('save', 'readwrite', (store, resolve) => {
      // Settlement comes from the transaction's `oncomplete` (the actual commit); only the
      // failure path needs handling here.
      const request = store.put(value, key);
      request.onerror = () => {
        warnSnapshotFailure('save', request.error);
        resolve(null);
      };
    });
  }

  /**
   * Opens the DB, starts a transaction, and hands the object store to `run` together with a
   * single-settle `resolve`. Any throw or async error along the way warns (naming `operation`)
   * and resolves `null` — the shared "broken cache is an absent cache" funnel.
   */
  private withStore(
    operation: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore, resolve: (value: string | null) => void) => void,
  ): Promise<string | null> {
    return new Promise((promiseResolve) => {
      let settled = false;
      const resolve = (value: string | null) => {
        if (!settled) {
          settled = true;
          promiseResolve(value);
        }
      };
      let request: IDBOpenDBRequest;
      try {
        const factory: IDBFactory | undefined = globalThis.indexedDB;
        if (!factory) {
          warnSnapshotFailure(operation, 'indexedDB is not available in this environment');
          resolve(null);
          return;
        }
        request = factory.open(DB_NAME, DB_VERSION);
      } catch (error) {
        warnSnapshotFailure(operation, error);
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains(OBJECT_STORE_NAME)) {
            request.result.createObjectStore(OBJECT_STORE_NAME);
          }
        } catch (error) {
          warnSnapshotFailure(operation, error);
          resolve(null);
        }
      };
      request.onerror = () => {
        warnSnapshotFailure(operation, request.error);
        resolve(null);
      };
      request.onsuccess = () => {
        const db = request.result;
        try {
          const transaction = db.transaction(OBJECT_STORE_NAME, mode);
          transaction.oncomplete = () => {
            db.close();
            // Settles writes at commit time; reads already settled from their request handler.
            resolve(null);
          };
          transaction.onabort = () => {
            warnSnapshotFailure(operation, transaction.error);
            db.close();
            resolve(null);
          };
          run(transaction.objectStore(OBJECT_STORE_NAME), resolve);
        } catch (error) {
          warnSnapshotFailure(operation, error);
          db.close();
          resolve(null);
        }
      };
    });
  }
}

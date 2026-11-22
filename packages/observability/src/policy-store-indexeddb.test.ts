// @module-tag pure
/**
 * Tests for the IndexedDB-backed `PolicyDecisionStore` (ADR-079,
 * persistence phase — issue #179 T1).
 *
 * Uses `fake-indexeddb`'s `IDBFactory`/`IDBKeyRange` exports injected
 * DIRECTLY into `createIndexedDBPolicyDecisionStore`/
 * `createPersistentPolicyDecisionStore` via their `indexedDB`/`idbKeyRange`
 * options, rather than the repo's more common `Object.defineProperty(globalThis,
 * 'indexedDB', ...)` per-test pattern (see
 * `apps/prompt-studio/src/vcs/snapshot-store.test.ts`) or `fake-indexeddb/auto`.
 * Both of those patch the GLOBAL — but Dexie resolves `Dexie.dependencies.indexedDB`
 * from `globalThis` exactly ONCE, in a module-level block the moment `dexie`
 * is first imported, not per `new Dexie(...)` call. A `beforeEach` mutation
 * (which runs long after this file's static imports already loaded `dexie`)
 * would have no effect on that already-captured snapshot — hence the
 * constructor-level DI this test file exercises instead. A fresh `IDBFactory`
 * per test (rather than one shared instance / `fake-indexeddb/auto`) still
 * gives full isolation between tests with no cross-test bleed.
 */

// @vitest-environment node

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import {
  createIndexedDBPolicyDecisionStore,
  createPersistentPolicyDecisionStore,
  supportsIndexedDB,
} from './policy-store-indexeddb';
import type { PolicyDecisionsBroadcastMessage } from './policy-store-indexeddb-broadcast';
import type { PolicyDecision } from './policy-types';

function makeDecision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    id: `pd-${Math.random().toString(36).slice(2, 8)}`,
    policy: 'signal-score-gate',
    outcome: 'allow',
    input: { signalId: 'sig-1', score: 42 },
    output: true,
    reasoning: 'score 42 ≥ threshold 40',
    entityRef: { kind: 'signal', id: 'sig-1' },
    policyVersion: 'v1',
    workspaceId: 'ws-1',
    timestamp: new Date().toISOString(),
    durationMs: 1,
    ...overrides,
  };
}

/** A fresh, isolated `fake-indexeddb` factory + its paired `IDBKeyRange`,
 *  for one test's exclusive use. */
function freshIndexedDB(): { indexedDB: IDBFactory; idbKeyRange: typeof IDBKeyRange } {
  return { indexedDB: new IDBFactory(), idbKeyRange: IDBKeyRange };
}

describe('supportsIndexedDB', () => {
  it("returns false when indexedDB is not defined on globalThis (this repo's default Node test env)", () => {
    expect(supportsIndexedDB()).toBe(false);
  });
});

describe('createIndexedDBPolicyDecisionStore — real IndexedDB (fake-indexeddb, injected)', () => {
  it('appends and lists decisions newest-first', async () => {
    const store = createIndexedDBPolicyDecisionStore({ ...freshIndexedDB(), broadcast: null });
    const t1 = '2026-05-10T10:00:00.000Z';
    const t2 = '2026-05-10T11:00:00.000Z';
    const t3 = '2026-05-10T12:00:00.000Z';

    await store.appendDecisions([makeDecision({ id: 'a', timestamp: t1 })]);
    await store.appendDecisions([makeDecision({ id: 'b', timestamp: t2 }), makeDecision({ id: 'c', timestamp: t3 })]);

    const list = await store.listDecisions();
    expect(list.map((d) => d.id)).toEqual(['c', 'b', 'a']);
  });

  it('filters by workspaceId + entityId via the [workspaceId+entityRef.id] index', async () => {
    const store = createIndexedDBPolicyDecisionStore({ ...freshIndexedDB(), broadcast: null });
    await store.appendDecisions([
      makeDecision({
        id: '1',
        workspaceId: 'ws-1',
        policy: 'signal-score-gate',
        entityRef: { kind: 'signal', id: 's1' },
      }),
      makeDecision({
        id: '2',
        workspaceId: 'ws-1',
        policy: 'can-receive-draft',
        entityRef: { kind: 'lead', id: 'l1' },
      }),
      makeDecision({
        id: '3',
        workspaceId: 'ws-1',
        policy: 'signal-score-gate',
        entityRef: { kind: 'signal', id: 's2' },
      }),
      makeDecision({
        id: '4',
        workspaceId: 'ws-2',
        policy: 'signal-score-gate',
        entityRef: { kind: 'signal', id: 's1' },
      }),
    ]);

    const onlyWs1S1 = await store.listDecisions({ workspaceId: 'ws-1', entityId: 's1' });
    expect(onlyWs1S1.map((d) => d.id)).toEqual(['1']);

    const onlyScoreGate = await store.listDecisions({ policy: 'signal-score-gate' });
    expect(onlyScoreGate.map((d) => d.id).sort()).toEqual(['1', '3', '4']);
  });

  it('filters by workspaceId + traceId via the [workspaceId+traceId] index', async () => {
    const store = createIndexedDBPolicyDecisionStore({ ...freshIndexedDB(), broadcast: null });
    await store.appendDecisions([
      makeDecision({ id: 'a', traceId: 'run-1', workspaceId: 'ws-1' }),
      makeDecision({ id: 'b', traceId: 'run-2', workspaceId: 'ws-1' }),
      makeDecision({ id: 'c', traceId: 'run-1', workspaceId: 'ws-2' }),
    ]);

    const run1Ws1 = await store.listDecisions({ workspaceId: 'ws-1', traceId: 'run-1' });
    expect(run1Ws1.map((d) => d.id)).toEqual(['a']);

    const ws1 = await store.listDecisions({ workspaceId: 'ws-1' });
    expect(ws1.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('filters by workspaceId alone via the [workspaceId+timestamp] index', async () => {
    const store = createIndexedDBPolicyDecisionStore({ ...freshIndexedDB(), broadcast: null });
    await store.appendDecisions([
      makeDecision({ id: 'a', workspaceId: 'ws-1' }),
      makeDecision({ id: 'b', workspaceId: 'ws-2' }),
    ]);

    const ws1 = await store.listDecisions({ workspaceId: 'ws-1' });
    expect(ws1.map((d) => d.id)).toEqual(['a']);
  });

  it('caps results at the supplied limit (default 100)', async () => {
    const store = createIndexedDBPolicyDecisionStore({ ...freshIndexedDB(), broadcast: null });
    const decisions = Array.from({ length: 130 }, (_, i) =>
      makeDecision({ id: `d-${i}`, timestamp: new Date(2_000_000_000_000 + i * 1000).toISOString() }),
    );
    await store.appendDecisions(decisions);

    const defaultList = await store.listDecisions();
    expect(defaultList).toHaveLength(100);

    const limited = await store.listDecisions({ limit: 25 });
    expect(limited).toHaveLength(25);
  });

  it('trimOlderThan removes decisions older than the cutoff and returns the count', async () => {
    const store = createIndexedDBPolicyDecisionStore({ ...freshIndexedDB(), broadcast: null });
    await store.appendDecisions([
      makeDecision({ id: 'old1', timestamp: '2026-04-01T00:00:00.000Z' }),
      makeDecision({ id: 'old2', timestamp: '2026-04-05T00:00:00.000Z' }),
      makeDecision({ id: 'new', timestamp: '2026-05-10T00:00:00.000Z' }),
    ]);

    const trimmed = await store.trimOlderThan('2026-04-15T00:00:00.000Z');
    expect(trimmed).toBe(2);

    const remaining = await store.listDecisions();
    expect(remaining.map((d) => d.id)).toEqual(['new']);
  });

  it('trimOlderThan is a no-op returning 0 when nothing is stale', async () => {
    const store = createIndexedDBPolicyDecisionStore({ ...freshIndexedDB(), broadcast: null });
    await store.appendDecisions([makeDecision({ id: 'fresh', timestamp: '2026-05-10T00:00:00.000Z' })]);
    expect(await store.trimOlderThan('2020-01-01T00:00:00.000Z')).toBe(0);
  });

  it('a second store instance reads what a first instance appended (same underlying database, "mount-unmount-mount")', async () => {
    const shared = freshIndexedDB();
    const dbName = 'salir-policy-decisions-mount-test';
    const writer = createIndexedDBPolicyDecisionStore({ ...shared, dbName, broadcast: null });
    await writer.appendDecisions([makeDecision({ id: 'shared', workspaceId: 'ws-1' })]);

    // A brand-new store instance, built from a SEPARATE `createIndexedDBPolicyDecisionStore`
    // call but pointed at the same `indexedDB` factory + database name — the
    // equivalent of an app remount reopening the same physical database.
    const reader = createIndexedDBPolicyDecisionStore({ ...shared, dbName, broadcast: null });
    const list = await reader.listDecisions({ workspaceId: 'ws-1' });
    expect(list.map((d) => d.id)).toEqual(['shared']);
  });

  it('appendDecisions notifies the broadcast once per distinct workspaceId in the batch', async () => {
    const notify = vi.fn();
    const store = createIndexedDBPolicyDecisionStore({
      ...freshIndexedDB(),
      broadcast: { notify, onMessage: () => () => {}, close: () => {} },
    });

    await store.appendDecisions([
      makeDecision({ id: '1', workspaceId: 'ws-1' }),
      makeDecision({ id: '2', workspaceId: 'ws-1' }),
      makeDecision({ id: '3', workspaceId: 'ws-2' }),
    ]);

    const calls = notify.mock.calls.map((call) => call[0] as PolicyDecisionsBroadcastMessage);
    expect(calls).toEqual(
      expect.arrayContaining([
        { type: 'policy-decisions:appended', workspaceId: 'ws-1', count: 2 },
        { type: 'policy-decisions:appended', workspaceId: 'ws-2', count: 1 },
      ]),
    );
    expect(calls).toHaveLength(2);
  });

  it('trimOlderThan notifies the broadcast per distinct workspaceId trimmed', async () => {
    const notify = vi.fn();
    const shared = freshIndexedDB();
    const dbName = 'salir-policy-decisions-trim-broadcast-test';
    const seedStore = createIndexedDBPolicyDecisionStore({ ...shared, dbName, broadcast: null });
    await seedStore.appendDecisions([
      makeDecision({ id: 'old-ws1', workspaceId: 'ws-1', timestamp: '2020-01-01T00:00:00.000Z' }),
      makeDecision({ id: 'old-ws2', workspaceId: 'ws-2', timestamp: '2020-01-01T00:00:00.000Z' }),
    ]);

    // Re-open the same database with a broadcast attached to observe the trim notification.
    const storeWithBroadcast = createIndexedDBPolicyDecisionStore({
      ...shared,
      dbName,
      broadcast: { notify, onMessage: () => () => {}, close: () => {} },
    });
    await storeWithBroadcast.trimOlderThan('2026-01-01T00:00:00.000Z');

    const calls = notify.mock.calls.map((call) => call[0] as PolicyDecisionsBroadcastMessage);
    expect(calls).toEqual(
      expect.arrayContaining([
        { type: 'policy-decisions:trimmed', workspaceId: 'ws-1', count: 1 },
        { type: 'policy-decisions:trimmed', workspaceId: 'ws-2', count: 1 },
      ]),
    );
    expect(calls).toHaveLength(2);
  });
});

describe('createPersistentPolicyDecisionStore — feature-detected factory', () => {
  it('falls back to the in-memory store when indexedDB is unavailable (no override supplied)', async () => {
    expect(globalThis.indexedDB).toBeUndefined();
    const store = createPersistentPolicyDecisionStore({ broadcast: null });
    await store.appendDecisions([makeDecision({ id: 'a' })]);
    expect(await store.listDecisions()).toHaveLength(1);
  });

  it('is truly IndexedDB-backed when given an explicit indexedDB/idbKeyRange override: two factory calls against the same dbName share persisted state', async () => {
    const shared = freshIndexedDB();
    const dbName = 'salir-policy-decisions-factory-test';
    const first = createPersistentPolicyDecisionStore({ ...shared, dbName, broadcast: null });
    await first.appendDecisions([makeDecision({ id: 'shared', workspaceId: 'ws-1' })]);

    const second = createPersistentPolicyDecisionStore({ ...shared, dbName, broadcast: null });
    const list = await second.listDecisions({ workspaceId: 'ws-1' });
    expect(list.map((d) => d.id)).toEqual(['shared']);
  });

  it('an explicit override is used even though globalThis.indexedDB is absent (bypasses feature-detection)', async () => {
    expect(globalThis.indexedDB).toBeUndefined();
    const shared = freshIndexedDB();
    const store = createPersistentPolicyDecisionStore({
      ...shared,
      dbName: 'salir-policy-decisions-override-test',
      broadcast: null,
    });
    await store.appendDecisions([makeDecision({ id: 'a' })]);
    // Proves this went to the REAL Dexie-backed store, not the in-memory
    // fallback: a second independent factory call sharing the same
    // `indexedDB` + dbName sees the same row.
    const reopened = createPersistentPolicyDecisionStore({
      ...shared,
      dbName: 'salir-policy-decisions-override-test',
      broadcast: null,
    });
    expect(await reopened.listDecisions()).toHaveLength(1);
  });
});

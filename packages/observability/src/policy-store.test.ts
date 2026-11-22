// @vitest-environment node
// @module-tag pure

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PolicyDecisionShape } from './policy-recorder';
import {
  createInMemoryPolicyDecisionStore,
  type PolicyEventSubscriber,
  subscribePolicyDecisionsToStore,
} from './policy-store';
import type { PolicyDecision } from './policy-types';

interface TestBus extends PolicyEventSubscriber {
  emit(event: 'policy:decided', payload: { decision: PolicyDecisionShape }): void;
}

function createTestBus(): TestBus {
  const handlers: Array<(payload: { decision: PolicyDecisionShape }) => void> = [];
  return {
    emit(_event, payload) {
      for (const h of handlers) h(payload);
    },
    on(_event, handler) {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
  };
}

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

describe('createInMemoryPolicyDecisionStore', () => {
  it('appends + lists decisions newest-first', async () => {
    const store = createInMemoryPolicyDecisionStore();
    const t1 = '2026-05-10T10:00:00.000Z';
    const t2 = '2026-05-10T11:00:00.000Z';
    const t3 = '2026-05-10T12:00:00.000Z';

    await store.appendDecisions([makeDecision({ id: 'a', timestamp: t1 })]);
    await store.appendDecisions([makeDecision({ id: 'b', timestamp: t2 }), makeDecision({ id: 'c', timestamp: t3 })]);

    const list = await store.listDecisions();
    expect(list.map((d) => d.id)).toEqual(['c', 'b', 'a']);
  });

  it('filters by entityId and policy', async () => {
    const store = createInMemoryPolicyDecisionStore();
    await store.appendDecisions([
      makeDecision({ id: '1', policy: 'signal-score-gate', entityRef: { kind: 'signal', id: 's1' } }),
      makeDecision({ id: '2', policy: 'can-receive-draft', entityRef: { kind: 'lead', id: 'l1' } }),
      makeDecision({ id: '3', policy: 'signal-score-gate', entityRef: { kind: 'signal', id: 's2' } }),
    ]);

    const onlyS1 = await store.listDecisions({ entityId: 's1' });
    expect(onlyS1.map((d) => d.id)).toEqual(['1']);

    const onlyScoreGate = await store.listDecisions({ policy: 'signal-score-gate' });
    expect(onlyScoreGate.map((d) => d.id).sort()).toEqual(['1', '3']);
  });

  it('filters by traceId and workspaceId', async () => {
    const store = createInMemoryPolicyDecisionStore();
    await store.appendDecisions([
      makeDecision({ id: 'a', traceId: 'run-1', workspaceId: 'ws-1' }),
      makeDecision({ id: 'b', traceId: 'run-2', workspaceId: 'ws-1' }),
      makeDecision({ id: 'c', traceId: 'run-1', workspaceId: 'ws-2' }),
    ]);

    const run1 = await store.listDecisions({ traceId: 'run-1' });
    expect(run1.map((d) => d.id).sort()).toEqual(['a', 'c']);

    const ws1 = await store.listDecisions({ workspaceId: 'ws-1' });
    expect(ws1.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('caps results at the supplied limit (default 100)', async () => {
    const store = createInMemoryPolicyDecisionStore();
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
    const store = createInMemoryPolicyDecisionStore();
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
});

describe('subscribePolicyDecisionsToStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches decisions and flushes after the debounce window', async () => {
    const bus = createTestBus();
    const store = createInMemoryPolicyDecisionStore();
    const subscriber = subscribePolicyDecisionsToStore(bus, store, { flushDebounceMs: 200 });

    bus.emit('policy:decided', { decision: makeDecision({ id: 'a' }) });
    bus.emit('policy:decided', { decision: makeDecision({ id: 'b' }) });

    expect(store.entries).toHaveLength(0); // not flushed yet

    await vi.advanceTimersByTimeAsync(199);
    expect(store.entries).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2);
    expect(store.entries.map((d) => d.id).sort()).toEqual(['a', 'b']);

    subscriber.dispose();
  });

  it('flushes immediately when maxBatchSize is reached', async () => {
    const bus = createTestBus();
    const store = createInMemoryPolicyDecisionStore();
    const subscriber = subscribePolicyDecisionsToStore(bus, store, {
      flushDebounceMs: 1000,
      maxBatchSize: 3,
    });

    bus.emit('policy:decided', { decision: makeDecision({ id: '1' }) });
    bus.emit('policy:decided', { decision: makeDecision({ id: '2' }) });
    bus.emit('policy:decided', { decision: makeDecision({ id: '3' }) });

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(store.entries).toHaveLength(3);

    subscriber.dispose();
  });

  it('flush() forces a sync write even before the debounce expires', async () => {
    const bus = createTestBus();
    const store = createInMemoryPolicyDecisionStore();
    const subscriber = subscribePolicyDecisionsToStore(bus, store, { flushDebounceMs: 10_000 });

    bus.emit('policy:decided', { decision: makeDecision({ id: 'x' }) });
    expect(store.entries).toHaveLength(0);

    await subscriber.flush();
    expect(store.entries).toHaveLength(1);

    subscriber.dispose();
  });

  it('dispose() drops pending entries and stops listening', async () => {
    const bus = createTestBus();
    const store = createInMemoryPolicyDecisionStore();
    const subscriber = subscribePolicyDecisionsToStore(bus, store, { flushDebounceMs: 200 });

    bus.emit('policy:decided', { decision: makeDecision({ id: 'dropped' }) });
    subscriber.dispose();

    bus.emit('policy:decided', { decision: makeDecision({ id: 'after-dispose' }) });
    await vi.advanceTimersByTimeAsync(500);

    expect(store.entries).toHaveLength(0);
  });

  it('forwards store errors to onError instead of swallowing them', async () => {
    const bus = createTestBus();
    const onError = vi.fn();
    const brokenStore = {
      ...createInMemoryPolicyDecisionStore(),
      appendDecisions: vi.fn().mockRejectedValue(new Error('disk full')),
    };
    const subscriber = subscribePolicyDecisionsToStore(bus, brokenStore, {
      flushDebounceMs: 50,
      onError,
    });

    bus.emit('policy:decided', { decision: makeDecision({ id: 'a' }) });
    await vi.advanceTimersByTimeAsync(60);
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe('disk full');

    subscriber.dispose();
  });

  it('trim() removes entries older than retentionDays', async () => {
    const bus = createTestBus();
    const store = createInMemoryPolicyDecisionStore();
    const subscriber = subscribePolicyDecisionsToStore(bus, store);

    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await store.appendDecisions([
      makeDecision({ id: 'old', timestamp: longAgo }),
      makeDecision({ id: 'fresh', timestamp: recent }),
    ]);

    const trimmed = await subscriber.trim(30);
    expect(trimmed).toBe(1);
    const remaining = await store.listDecisions();
    expect(remaining.map((d) => d.id)).toEqual(['fresh']);

    subscriber.dispose();
  });
});

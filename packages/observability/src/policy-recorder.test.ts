// @vitest-environment node
// @module-tag pure

import { describe, expect, it, vi } from 'vitest';
import { createPolicyRecorder, type PolicyDecisionShape, type PolicyEventEmitter } from './policy-recorder';

interface TestBus extends PolicyEventEmitter {
  on(event: 'policy:decided', handler: (payload: { decision: PolicyDecisionShape }) => void): void;
}

function createTestBus(): TestBus {
  const handlers: Array<(payload: { decision: PolicyDecisionShape }) => void> = [];
  return {
    emit(_event, payload) {
      for (const h of handlers) h(payload);
    },
    on(_event, handler) {
      handlers.push(handler);
    },
  };
}

function collect(): {
  bus: TestBus;
  emitted: Array<{ decision: PolicyDecisionShape }>;
} {
  const bus = createTestBus();
  const emitted: Array<{ decision: PolicyDecisionShape }> = [];
  bus.on('policy:decided', (payload) => {
    emitted.push(payload);
  });
  return { bus, emitted };
}

describe('createPolicyRecorder', () => {
  it('emits one policy:decided event per record() call', () => {
    const { bus, emitted } = collect();
    const recorder = createPolicyRecorder(bus, { generateId: () => 'pd-fixed-1' });

    recorder.record({
      policy: 'signal-score-gate',
      input: { signalId: 'sig-1', score: 42, threshold: 40 },
      invoke: () => true,
      reason: (allowed) => ({
        outcome: allowed ? 'allow' : 'block',
        reasoning: allowed ? 'score 42 ≥ threshold 40' : 'score 42 below threshold 40',
      }),
      entityRef: { kind: 'signal', id: 'sig-1' },
      workspaceId: 'ws-1',
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].decision.policy).toBe('signal-score-gate');
    expect(emitted[0].decision.outcome).toBe('allow');
    expect(emitted[0].decision.reasoning).toBe('score 42 ≥ threshold 40');
    expect(emitted[0].decision.id).toBe('pd-fixed-1');
  });

  it('returns the invocation result unchanged', () => {
    const { bus } = collect();
    const recorder = createPolicyRecorder(bus);

    const result = recorder.record({
      policy: 'signal-score-gate',
      input: { score: 30 },
      invoke: () => 'specific-value',
      reason: () => ({ outcome: 'allow', reasoning: 'noop' }),
      entityRef: { kind: 'signal', id: 's' },
      workspaceId: 'ws-1',
    });

    expect(result).toBe('specific-value');
  });

  it('captures duration as elapsed time across the invocation', () => {
    const { bus, emitted } = collect();
    let t = 1000;
    const recorder = createPolicyRecorder(bus, {
      now: () => t,
      generateId: () => 'pd-1',
    });

    recorder.record({
      policy: 'signal-score-gate',
      input: {},
      invoke: () => {
        t += 17;
        return true;
      },
      reason: () => ({ outcome: 'allow', reasoning: 'r' }),
      entityRef: { kind: 'signal', id: 's' },
      workspaceId: 'ws-1',
    });

    expect(emitted[0].decision.durationMs).toBe(17);
  });

  it('records timestamp from the post-invocation clock reading', () => {
    const { bus, emitted } = collect();
    let t = 1_700_000_000_000;
    const recorder = createPolicyRecorder(bus, {
      now: () => t,
      generateId: () => 'pd-1',
    });

    recorder.record({
      policy: 'signal-score-gate',
      input: {},
      invoke: () => {
        t += 5_000;
        return true;
      },
      reason: () => ({ outcome: 'allow', reasoning: 'r' }),
      entityRef: { kind: 'signal', id: 's' },
      workspaceId: 'ws-1',
    });

    expect(emitted[0].decision.timestamp).toBe(new Date(1_700_000_005_000).toISOString());
  });

  it('does NOT emit when the invocation throws (only completed decisions are recorded)', () => {
    const { bus, emitted } = collect();
    const recorder = createPolicyRecorder(bus);

    expect(() =>
      recorder.record({
        policy: 'signal-score-gate',
        input: { score: 30 },
        invoke: () => {
          throw new Error('boom');
        },
        reason: () => ({ outcome: 'allow', reasoning: 'unreachable' }),
        entityRef: { kind: 'signal', id: 's' },
        workspaceId: 'ws-1',
      }),
    ).toThrow('boom');
    expect(emitted).toHaveLength(0);
  });

  it('masks sensitive fields in both input and output', () => {
    const { bus, emitted } = collect();
    const recorder = createPolicyRecorder(bus, { generateId: () => 'pd-1' });

    recorder.record({
      policy: 'can-receive-draft',
      input: {
        leadId: 'lead-1',
        email: 'cto@acme.test',
        apiKey: 'sk-abc1234567890',
      },
      invoke: () => ({ allowed: false, recipientEmail: 'cto@acme.test' }),
      reason: () => ({ outcome: 'block', reasoning: 'lead status is unsubscribed' }),
      entityRef: { kind: 'lead', id: 'lead-1' },
      workspaceId: 'ws-1',
    });

    const input = emitted[0].decision.input as Record<string, unknown>;
    const output = emitted[0].decision.output as Record<string, unknown>;
    expect(input.email).toBe('***');
    expect(input.apiKey).toBe('***');
    expect(output.recipientEmail).toBe('***');
    expect(input.leadId).toBe('lead-1');
  });

  it('defaults policyVersion to "v1" when not supplied', () => {
    const { bus, emitted } = collect();
    const recorder = createPolicyRecorder(bus, { generateId: () => 'pd-1' });

    recorder.record({
      policy: 'signal-score-gate',
      input: {},
      invoke: () => true,
      reason: () => ({ outcome: 'allow', reasoning: 'r' }),
      entityRef: { kind: 'signal', id: 's' },
      workspaceId: 'ws-1',
    });

    expect(emitted[0].decision.policyVersion).toBe('v1');
  });

  it('preserves an explicit policyVersion override', () => {
    const { bus, emitted } = collect();
    const recorder = createPolicyRecorder(bus, { generateId: () => 'pd-1' });

    recorder.record({
      policy: 'insight-select',
      input: {},
      invoke: () => null,
      reason: () => ({ outcome: 'no-op', reasoning: 'no candidates' }),
      entityRef: { kind: 'lead', id: 'l1' },
      workspaceId: 'ws-1',
      policyVersion: 'v3',
    });

    expect(emitted[0].decision.policyVersion).toBe('v3');
  });

  it('propagates traceId when provided so multiple decisions can be grouped to one run', () => {
    const { bus, emitted } = collect();
    const recorder = createPolicyRecorder(bus, { generateId: () => 'pd-1' });

    recorder.record({
      policy: 'stage-transition',
      input: { from: 2, to: 3 },
      invoke: () => 3,
      reason: () => ({ outcome: 'transition', reasoning: 'auto-critic advanced from stage 2 to 3' }),
      entityRef: { kind: 'lead', id: 'lead-1' },
      workspaceId: 'ws-1',
      traceId: 'run-xyz-123',
    });

    expect(emitted[0].decision.traceId).toBe('run-xyz-123');
  });

  it('allows mask to be replaced for tests that need the raw payload', () => {
    const { bus, emitted } = collect();
    const passthrough = vi.fn((x: unknown) => x);
    const recorder = createPolicyRecorder(bus, {
      generateId: () => 'pd-1',
      mask: passthrough as <T>(payload: T) => T,
    });

    recorder.record({
      policy: 'insight-select',
      input: { email: 'real@example.com' },
      invoke: () => ({ insightId: 'ins-1', email: 'real@example.com' }),
      reason: () => ({ outcome: 'select', reasoning: 'picked ins-1' }),
      entityRef: { kind: 'lead', id: 'l1' },
      workspaceId: 'ws-1',
    });

    expect(passthrough).toHaveBeenCalledTimes(2);
    const input = emitted[0].decision.input as Record<string, unknown>;
    expect(input.email).toBe('real@example.com');
  });
});

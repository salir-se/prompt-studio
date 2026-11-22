/**
 * Tests for `createPolicyDecisionsBroadcast` (ADR-079, persistence phase —
 * issue #179 T1). Node has a native global `BroadcastChannel` (since
 * Node 18), and separate instances constructed with the same channel
 * name deliver messages to each other within a single process — no
 * `fake-indexeddb`-style polyfill needed here.
 */

// @vitest-environment node
// @module-tag pure

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPolicyDecisionsBroadcast,
  POLICY_DECISIONS_BROADCAST_CHANNEL,
  type PolicyDecisionsBroadcast,
} from './policy-store-indexeddb-broadcast';

function waitForCall(fn: ReturnType<typeof vi.fn>, times = 1): Promise<void> {
  return vi.waitFor(() => {
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(times);
  });
}

describe('createPolicyDecisionsBroadcast', () => {
  const opened: PolicyDecisionsBroadcast[] = [];

  afterEach(() => {
    for (const handle of opened.splice(0)) handle.close();
  });

  function open(channelName?: string): PolicyDecisionsBroadcast {
    const handle = createPolicyDecisionsBroadcast(channelName);
    opened.push(handle);
    return handle;
  }

  it('uses "salir-policy-decisions" as the default channel name', () => {
    expect(POLICY_DECISIONS_BROADCAST_CHANNEL).toBe('salir-policy-decisions');
  });

  it('delivers a notify() from one handle to onMessage() on another handle on the same channel', async () => {
    const sender = open('policy-decisions-test-basic');
    const receiver = open('policy-decisions-test-basic');
    const handler = vi.fn();
    receiver.onMessage(handler);

    sender.notify({ type: 'policy-decisions:appended', workspaceId: 'ws-1', count: 2 });

    await waitForCall(handler);
    expect(handler).toHaveBeenCalledWith({ type: 'policy-decisions:appended', workspaceId: 'ws-1', count: 2 });
  });

  it('delivers a trimmed notification the same way', async () => {
    const sender = open('policy-decisions-test-trim');
    const receiver = open('policy-decisions-test-trim');
    const handler = vi.fn();
    receiver.onMessage(handler);

    sender.notify({ type: 'policy-decisions:trimmed', workspaceId: 'ws-9', count: 3 });

    await waitForCall(handler);
    expect(handler).toHaveBeenCalledWith({ type: 'policy-decisions:trimmed', workspaceId: 'ws-9', count: 3 });
  });

  it('does not deliver messages across two differently-named channels', async () => {
    const sender = open('policy-decisions-test-a');
    const receiver = open('policy-decisions-test-b');
    const handler = vi.fn();
    receiver.onMessage(handler);

    sender.notify({ type: 'policy-decisions:appended', workspaceId: 'ws-1', count: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(handler).not.toHaveBeenCalled();
  });

  it('onMessage() returns an unsubscribe function that stops further delivery', async () => {
    const sender = open('policy-decisions-test-unsub');
    const receiver = open('policy-decisions-test-unsub');
    const handler = vi.fn();
    const unsubscribe = receiver.onMessage(handler);

    unsubscribe();
    sender.notify({ type: 'policy-decisions:appended', workspaceId: 'ws-1', count: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(handler).not.toHaveBeenCalled();
  });

  it('notify() and close() never throw even without a live listener', () => {
    const handle = open('policy-decisions-test-lonely');
    expect(() => handle.notify({ type: 'policy-decisions:appended', workspaceId: 'ws-1', count: 1 })).not.toThrow();
    expect(() => handle.close()).not.toThrow();
    // A second close() must also be safe (idempotent).
    expect(() => handle.close()).not.toThrow();
  });

  // ── No cross-talk with @prompt-studio/sync's lock-release channel ────────────
  //
  // packages/sync/src/broadcast.ts owns the literal channel name
  // 'salir-sync' and only ever posts `{ type: 'released', key }`. This
  // package cannot import @prompt-studio/sync to reuse that constant (@prompt-studio/sync
  // depends on @prompt-studio/observability — importing it back would be a
  // dependency cycle), so the literal is duplicated here deliberately, to
  // prove the two channels are distinct and never cross-talk.
  it('never receives messages posted on @prompt-studio/sync\'s "salir-sync" channel, and vice versa', async () => {
    const SALIR_SYNC_CHANNEL_NAME = 'salir-sync';
    expect(POLICY_DECISIONS_BROADCAST_CHANNEL).not.toBe(SALIR_SYNC_CHANNEL_NAME);

    const policyReceiver = open(POLICY_DECISIONS_BROADCAST_CHANNEL);
    const policyHandler = vi.fn();
    policyReceiver.onMessage(policyHandler);

    const syncChannel = new BroadcastChannel(SALIR_SYNC_CHANNEL_NAME);
    const syncHandler = vi.fn();
    syncChannel.addEventListener('message', (event) => syncHandler(event.data));

    try {
      // A lock-release message on 'salir-sync' must never reach the policy
      // decisions listener...
      syncChannel.postMessage({ type: 'released', key: 'some-lock-key' });
      // ...and a policy-decisions notification must never reach a
      // 'salir-sync' listener.
      const policySender = open(POLICY_DECISIONS_BROADCAST_CHANNEL);
      policySender.notify({ type: 'policy-decisions:appended', workspaceId: 'ws-1', count: 1 });

      await waitForCall(policyHandler);
      expect(policyHandler).toHaveBeenCalledWith({ type: 'policy-decisions:appended', workspaceId: 'ws-1', count: 1 });
      expect(syncHandler).not.toHaveBeenCalled();
    } finally {
      syncChannel.close();
    }
  });

  it('gracefully no-ops when BroadcastChannel is unavailable in this environment', () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error — simulating an environment without BroadcastChannel.
    delete globalThis.BroadcastChannel;
    try {
      const handle = createPolicyDecisionsBroadcast('policy-decisions-test-no-bc');
      const handler = vi.fn();
      const unsubscribe = handle.onMessage(handler);
      expect(() => handle.notify({ type: 'policy-decisions:appended', workspaceId: 'ws-1', count: 1 })).not.toThrow();
      expect(() => unsubscribe()).not.toThrow();
      expect(() => handle.close()).not.toThrow();
      expect(handler).not.toHaveBeenCalled();
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });
});

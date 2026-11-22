/**
 * BroadcastChannel wrapper for cross-tab notifications when the
 * IndexedDB-backed `PolicyDecisionStore` (`policy-store-indexeddb.ts`)
 * changes — a decision batch was appended, or the retention sweep trimmed
 * stale entries. Lets a React layer in another tab invalidate its
 * "Why?" popover / Decisions timeline query instead of going stale until
 * its own tab writes again.
 *
 * DELIBERATELY a distinct channel name and message shape from
 * `@prompt-studio/sync`'s `packages/sync/src/broadcast.ts` ('salir-sync', which
 * only ever carries `{ type: 'released', key }` lock-release notices).
 * `@prompt-studio/sync` depends on `@prompt-studio/observability` (see its package.json),
 * so this package cannot import `@prompt-studio/sync` back without creating a
 * dependency cycle — the channel name below is a literal, not a shared
 * import, and `policy-store-indexeddb-broadcast.test.ts` asserts the two
 * channels never cross-talk.
 *
 * See ADR-079 (persistence phase, issue #179 T1).
 */

export const POLICY_DECISIONS_BROADCAST_CHANNEL = 'salir-policy-decisions';

export type PolicyDecisionsBroadcastMessage =
  | { type: 'policy-decisions:appended'; workspaceId: string; count: number }
  | { type: 'policy-decisions:trimmed'; workspaceId: string; count: number };

export interface PolicyDecisionsBroadcast {
  /** Best-effort notify — never throws even if the channel is closed or
   *  BroadcastChannel is unavailable in this environment. */
  notify(message: PolicyDecisionsBroadcastMessage): void;
  /** Subscribe to messages from other tabs on this channel. Returns an
   *  unsubscribe function. No-ops (and returns a no-op cleanup) when
   *  BroadcastChannel is unavailable. */
  onMessage(handler: (message: PolicyDecisionsBroadcastMessage) => void): () => void;
  /** Release the underlying channel. Safe to call more than once. */
  close(): void;
}

/** Feature-detect BroadcastChannel availability the same way the store
 *  feature-detects IndexedDB — some embedders (older WebViews, certain
 *  test harnesses) omit it entirely. */
function supportsBroadcastChannel(): boolean {
  try {
    return typeof BroadcastChannel !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Create a broadcast handle bound to one BroadcastChannel. Production
 * callers omit `channelName` and get `POLICY_DECISIONS_BROADCAST_CHANNEL`;
 * tests pass a unique name for isolation the same way `@prompt-studio/queue`'s
 * `QueueEngine` derives its channel name from an overridden `dbName`.
 */
export function createPolicyDecisionsBroadcast(
  channelName: string = POLICY_DECISIONS_BROADCAST_CHANNEL,
): PolicyDecisionsBroadcast {
  let channel: BroadcastChannel | null = null;
  if (supportsBroadcastChannel()) {
    try {
      channel = new BroadcastChannel(channelName);
    } catch {
      channel = null;
    }
  }

  return {
    notify(message) {
      try {
        channel?.postMessage(message);
      } catch {
        // Channel closed or otherwise unavailable — notification is
        // best-effort, never load-bearing for correctness within a tab.
      }
    },
    onMessage(handler) {
      if (!channel) return () => {};
      const activeChannel = channel;
      const listener = (event: MessageEvent<PolicyDecisionsBroadcastMessage>): void => {
        handler(event.data);
      };
      activeChannel.addEventListener('message', listener);
      return () => activeChannel.removeEventListener('message', listener);
    },
    close() {
      try {
        channel?.close();
      } catch {
        // Already closed — ignore.
      }
    },
  };
}

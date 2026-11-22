/**
 * Issue #1085 (Phase 1): Anthropic prompt-caching request shaping.
 *
 * Shared by BOTH live Anthropic-wire request builders — `api.ts`'s
 * `callWithRetry`/`callWithRetryStreaming` (the default anthropic/zai path
 * `runAgent` routes through) and `providers/anthropic.ts`'s `buildBody` (the
 * provider path used for a `provider` override and by non-`runAgent` callers
 * like `packages/engine`/`critic-inbound.ts`) — so the two request bodies can
 * never drift on where the cache breakpoint lands.
 *
 * Gating (on/off) is a caller decision: this package never reads a feature
 * flag itself — see `AgentRunOptions.promptCaching`'s doc comment.
 */

import type { ToolDefinition } from '@prompt-studio/prompts';

/** Anthropic ephemeral cache breakpoint. */
export interface CacheControl {
  type: 'ephemeral';
}

/** A `system` block carrying a cache breakpoint. */
export interface CachedSystemBlock {
  type: 'text';
  text: string;
  cache_control: CacheControl;
}

/** A tool definition carrying a cache breakpoint on its own entry. */
export type CachedToolDefinition = ToolDefinition & { cache_control: CacheControl };

export interface PromptCachingBody {
  system: string | CachedSystemBlock[];
  tools: ReadonlyArray<ToolDefinition | CachedToolDefinition>;
}

/**
 * Shapes the `system` and `tools` fields of an Anthropic Messages API request
 * body for prompt caching.
 *
 * `enabled` falsy (the flag-off default) returns `systemPrompt`/`tools`
 * UNCHANGED — same reference, same shape — so the serialized request body
 * stays byte-identical to the pre-caching contract.
 *
 * `enabled` true:
 *  - `system` becomes a single-block array (Anthropic's `system` field takes
 *    either a bare string or a block array; caching needs the block form so
 *    `cache_control` has somewhere to attach), with the breakpoint on that
 *    one block — the LAST (and only) system block.
 *  - `tools`, when non-empty, gets the breakpoint on its LAST entry only.
 *    Anthropic prompt caching is a prefix match: one breakpoint at the tail
 *    of a stable, ordered tool list caches the entire tools prefix, so an
 *    earlier entry doesn't need its own marker.
 */
export function applyPromptCaching(
  systemPrompt: string,
  tools: readonly ToolDefinition[],
  enabled: boolean | undefined,
): PromptCachingBody {
  if (!enabled) return { system: systemPrompt, tools };

  const cacheControl: CacheControl = { type: 'ephemeral' };
  const lastIndex = tools.length - 1;
  const cachedTools: ReadonlyArray<ToolDefinition | CachedToolDefinition> =
    lastIndex < 0
      ? tools
      : tools.map((tool, index) => (index === lastIndex ? { ...tool, cache_control: cacheControl } : tool));

  return {
    system: [{ type: 'text', text: systemPrompt, cache_control: cacheControl }],
    tools: cachedTools,
  };
}

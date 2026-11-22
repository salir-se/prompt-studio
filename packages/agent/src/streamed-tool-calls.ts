/**
 * Accumulator for tool calls arriving over a streaming LLM response.
 *
 * Both wire formats we speak identify a streamed tool call by a numeric key
 * that is stable for the whole call and independent of arrival order —
 * Anthropic's `content_block` index, OpenAI's `tool_calls[].index`. Both are
 * also free to open every call up front and back-fill the argument fragments
 * afterwards, in any interleaving.
 *
 * Every accumulator here used to ignore that key and append each argument
 * fragment to "whichever tool block was pushed last", which only holds when
 * the provider finishes one call before starting the next. When it doesn't,
 * two calls' JSON fragments land in one buffer, the parse throws, and BOTH
 * calls dispatch with `input: {}` — the failure mode behind an agent turn that
 * plans four tool calls (two of them the same tool) and executes three.
 *
 * Keying by the wire's own key fixes that and makes duplicate calls to the
 * SAME tool a non-event: they are two keys, never one.
 */

import type { ContentBlock } from './types';

/** A tool block plus whether this sighting is the one that created it. */
export interface OpenedToolCall {
  /** The `tool_use` block. Push it into the response content when `isNew`. */
  block: ContentBlock;
  /**
   * `true` only for the fragment that first introduced this call. Providers
   * that repeat `function.name` on every argument fragment (several
   * OpenAI-compatible servers do) would otherwise forge a phantom block — and
   * fire a spurious `onToolCallStart` — per fragment.
   */
  isNew: boolean;
}

export class StreamedToolCalls {
  private readonly entries = new Map<string, { block: ContentBlock; args: string }>();
  /** Key of the most recently opened call — the fallback for a wire that omits
   *  its index, where "the call still being built" is the only identity there
   *  is. That reproduces the pre-index behavior exactly for such a stream. */
  private lastKey: string | undefined;

  /**
   * Return the block for `key`, creating it on first sight. A later sighting
   * fills in an `id` or `name` the first one lacked (OpenAI sends the id with
   * the opening fragment only; a fragment-only chunk carries neither).
   *
   * `extra` carries a vendor payload that must round-trip on the block (see
   * `ContentBlock.providerExtra`) — e.g. Google's `extra_content` on a
   * streamed Gemini function call. It can arrive on the same fragment as the
   * name/id, on its own fragment, or not at all, so it's merged the same
   * fill-in way as `id`/`name` rather than only being accepted at creation.
   */
  open(
    key: string | number,
    id: string | undefined,
    name: string | undefined,
    extra?: Record<string, unknown>,
  ): OpenedToolCall {
    const mapKey = String(key);
    this.lastKey = mapKey;
    const existing = this.entries.get(mapKey);
    if (existing) {
      if (id) existing.block.id = id;
      if (name) existing.block.name = name;
      if (extra) existing.block.providerExtra = extra;
      return { block: existing.block, isNew: false };
    }
    // A synthetic id keeps the `tool_use` → `tool_result` pairing intact for a
    // provider that never sends one; the API rejects an unpaired id outright.
    const block: ContentBlock = {
      type: 'tool_use',
      id: id || `call_${mapKey}`,
      name,
      input: {},
      ...(extra ? { providerExtra: extra } : {}),
    };
    this.entries.set(mapKey, { block, args: '' });
    return { block, isNew: true };
  }

  /**
   * Append an argument fragment to `key`'s buffer. `undefined` targets the
   * most recently opened call (a stream that sends no index). No-op when the
   * key was never opened.
   */
  append(key: string | number | undefined, fragment: string): void {
    const entry = this.entries.get(this.resolveKey(key));
    if (entry) entry.args += fragment;
  }

  /** The id assigned to `key`, for callbacks that report per-call progress. */
  idFor(key: string | number | undefined): string | undefined {
    return this.entries.get(this.resolveKey(key))?.block.id;
  }

  private resolveKey(key: string | number | undefined): string {
    return key === undefined ? (this.lastKey ?? '') : String(key);
  }

  /**
   * Count of distinct calls opened so far — a safe position-based fallback
   * key for a wire that gives NEITHER an index NOR an id on a fragment. Must
   * be entry count, not "how many have been pushed into the caller's content
   * array": a call can be opened (e.g. by an extra_content-only fragment)
   * before it has a name, and `content` only grows once a name is seen. Using
   * a push-based count there let two such not-yet-named fragments compute the
   * SAME fallback key and collapse into one entry.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Parse each call's buffered argument JSON into its block's `input`. A block
   * whose buffer is empty or unparseable keeps `input: {}` (the pre-existing
   * safe fallback) and is reported through `onParseError` so the caller can
   * log it against its own logger.
   */
  finalize(onParseError?: (block: ContentBlock) => void): void {
    for (const { block, args } of this.entries.values()) {
      if (!args) continue;
      try {
        block.input = JSON.parse(args);
      } catch {
        onParseError?.(block);
      }
    }
  }
}

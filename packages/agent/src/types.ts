/** Provider-neutral message content and response shapes shared by every LLM provider adapter. */

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  /** Signature for a `thinking` block; required to replay the block back to the API. */
  signature?: string;
  /** Opaque payload for a `redacted_thinking` block. */
  data?: string;
  /**
   * Vendor-specific payload on a `tool_use` block that must be echoed back
   * verbatim on the SAME block when it is replayed as conversation history —
   * e.g. Google's Gemini OpenAI-compat surface rejects a replayed function
   * call whose `extra_content.google.thought_signature` is missing ("Function
   * call is missing a thought_signature ... required for tools to work
   * correctly"). Kept as an opaque bag rather than a `google`-shaped field:
   * `ContentBlock` is the shared Anthropic-shaped carrier every provider
   * uses, so a vendor-named field here would leak one provider into it.
   * Absent for every block that doesn't need this round trip.
   */
  providerExtra?: Record<string, unknown>;
}

export interface ApiResponse {
  usage: {
    input_tokens: number;
    output_tokens: number;
    /**
     * Issue #1085 (Phase 0): Anthropic prompt-cache write tokens for this
     * response, when the provider reports them. Expand-only — absent (never
     * coerced to `0`) on providers/requests that don't use caching.
     */
    cache_creation_input_tokens?: number;
    /** Issue #1085 (Phase 0): Anthropic prompt-cache read tokens. See {@link cache_creation_input_tokens}. */
    cache_read_input_tokens?: number;
  };
  stop_reason: string;
  content: ContentBlock[];
}

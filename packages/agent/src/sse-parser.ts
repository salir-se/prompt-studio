/**
 * SSE stream parser for Anthropic Messages API streaming responses.
 *
 * Parses `ReadableStream` from `fetch()` with `stream: true` into typed events.
 * No DOM dependencies — safe for Web Workers and headless environments.
 */

import { LlmHttpError } from './llm-http-error';

export interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Parse an SSE stream from a Response body into individual events.
 * Handles partial chunks, multi-line data fields, and abort signals.
 */
export async function* parseSSEStream(response: Response, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          yield { event: currentEvent || 'message', data };
        }
        // Empty line resets current event (SSE spec)
        if (line === '') {
          currentEvent = '';
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      if (buffer.startsWith('data: ')) {
        const data = buffer.slice(6);
        if (data !== '[DONE]') {
          yield { event: currentEvent || 'message', data };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Anthropic-specific event parsing ────────────────────────

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onThinking: (text: string) => void;
  /** `blockIndex` is the stream's own `content_block` index — the only stable
   *  identity for a call whose argument fragments arrive later, or interleaved
   *  with another call's. Additive: existing two-arg handlers still type-check. */
  onToolCallStart: (name: string, id: string, blockIndex?: number) => void;
  /** `id` is the block index as a string, kept for wire compatibility with the
   *  original signature; prefer the numeric `blockIndex`. */
  onToolCallDelta: (id: string, delta: string, blockIndex?: number) => void;
  /**
   * `cacheCreationInputTokens`/`cacheReadInputTokens` (issue #1085 Phase 0)
   * arrive only on `message_start` (Anthropic sends the cache breakdown once,
   * not incrementally) — omitted (not `0`) on every other `onUsage` call,
   * including the `message_delta` output-token update.
   */
  onUsage: (
    inputTokens: number,
    outputTokens: number,
    cacheCreationInputTokens?: number,
    cacheReadInputTokens?: number,
  ) => void;
  onStop: (stopReason: string) => void;
  /** Signature for a completed `thinking` block; required to replay it back to the API. */
  onSignature?: (signature: string) => void;
  /** Opaque payload for a `redacted_thinking` block; required to replay it back to the API. */
  onRedactedThinking?: (data: string) => void;
  /**
   * Issue #1824 (F1b): fired on the real `message_stop` event, the only
   * signal that the turn actually finished. A caller uses this to tell a
   * complete stream apart from one that was cut off mid-turn (a dropped
   * connection, an upstream timeout) — EOF with no `message_stop` must never
   * be read as "the model stopped naturally".
   */
  onMessageStop?: () => void;
}

/**
 * Anthropic's documented mapping from a streamed `error` event's
 * `error.type` to the HTTP status the same failure would carry on the
 * non-streaming endpoint (https://docs.anthropic.com/en/api/errors). Used
 * only to classify a MID-STREAM error the same way `handleErrorResponse`
 * classifies a rejected HTTP response — so the existing 429/529
 * transient-retry and overload-guard logic (`isOverloadStatus`) treats both
 * the same way. Unknown types fall back to `500` (retryable-adjacent,
 * matching Anthropic's own `api_error`).
 */
const ANTHROPIC_STREAM_ERROR_STATUS: Readonly<Record<string, number>> = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
};

/**
 * A mid-stream Anthropic `error` SSE event (issue #1824 F1a). Thrown instead
 * of silently ending the turn, so a truncated response is never mistaken for
 * a completed one and an `overloaded_error`/`rate_limit_error` is
 * classifiable as transient the same way a non-streaming 529/429 is —
 * `status` reuses {@link LlmHttpError}'s field on purpose, so
 * `isOverloadStatus(err.status)` and pooled-key classification keep working
 * unchanged for a caller that only ever saw HTTP-level failures before.
 */
export class AnthropicStreamError extends LlmHttpError {
  /** The upstream `error.type`, e.g. `overloaded_error`, `rate_limit_error`. */
  readonly errorType: string;

  constructor(errorType: string, message: string) {
    super(ANTHROPIC_STREAM_ERROR_STATUS[errorType] ?? 500, message);
    this.name = 'AnthropicStreamError';
    this.errorType = errorType;
  }
}

/**
 * Process parsed SSE events into typed callbacks for the Anthropic Messages API.
 *
 * Handles: message_start, content_block_start, content_block_delta,
 * content_block_stop, message_delta, message_stop, error.
 *
 * Only `JSON.parse` failures are swallowed (a malformed individual event is
 * skipped, matching the pre-#1824 behavior). A well-formed `error` event
 * (issue #1824 F1a) throws {@link AnthropicStreamError} instead — an upstream
 * `error` event is a real failure, never a no-op like an unrecognized `type`.
 */
export function processAnthropicEvent(event: SSEEvent, callbacks: StreamCallbacks): void {
  let parsed: any;
  try {
    parsed = JSON.parse(event.data);
  } catch {
    // Ignore parse errors for individual events
    return;
  }

  switch (parsed.type) {
    case 'message_start':
      if (parsed.message?.usage) {
        callbacks.onUsage(
          parsed.message.usage.input_tokens ?? 0,
          0,
          parsed.message.usage.cache_creation_input_tokens,
          parsed.message.usage.cache_read_input_tokens,
        );
      }
      break;

    case 'content_block_start': {
      const block = parsed.content_block;
      if (block?.type === 'tool_use') {
        callbacks.onToolCallStart(block.name, block.id, parsed.index);
      } else if (block?.type === 'redacted_thinking') {
        callbacks.onRedactedThinking?.(block.data);
      }
      // 'thinking' block start carries no content yet (text arrives via thinking_delta,
      // signature via signature_delta) — intentionally a no-op here.
      break;
    }

    case 'content_block_delta': {
      const delta = parsed.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        callbacks.onToken(delta.text);
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        callbacks.onThinking(delta.thinking);
      } else if (delta?.type === 'signature_delta' && delta.signature) {
        callbacks.onSignature?.(delta.signature);
      } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
        callbacks.onToolCallDelta(parsed.index?.toString() ?? '', delta.partial_json, parsed.index);
      }
      break;
    }

    case 'message_delta':
      if (parsed.usage) {
        // Issue #1824 (F2): `input_tokens` is normally omitted here (Anthropic
        // reports it once, on `message_start`), but some Anthropic-compatible
        // vendors send `0` on `message_start` and the real count here instead.
        // Passed through unconditionally (`?? 0`, matching the existing
        // `output_tokens` handling) — the caller's accumulator decides whether
        // a `0` ever lowers what it already recorded (it must not).
        callbacks.onUsage(
          parsed.usage.input_tokens ?? 0,
          parsed.usage.output_tokens ?? 0,
          parsed.usage.cache_creation_input_tokens,
          parsed.usage.cache_read_input_tokens,
        );
      }
      if (parsed.delta?.stop_reason) {
        callbacks.onStop(parsed.delta.stop_reason);
      }
      break;

    case 'message_stop':
      // Stream complete — onStop already fired via message_delta; this is the
      // only signal a caller can use to tell a finished turn apart from one
      // truncated by EOF (issue #1824 F1b) — see `onMessageStop`.
      callbacks.onMessageStop?.();
      break;

    case 'error': {
      // Issue #1824 (F1a): an Anthropic SSE `error` event was previously
      // dropped by the catch-all below, so an `overloaded_error`/
      // `rate_limit_error` mid-stream silently ended the turn with whatever
      // partial content had arrived instead of surfacing as a failure.
      const errorType = typeof parsed.error?.type === 'string' ? parsed.error.type : 'unknown_error';
      const message = typeof parsed.error?.message === 'string' ? parsed.error.message : 'Unknown streaming error';
      throw new AnthropicStreamError(errorType, `${errorType}: ${message}`);
    }
  }
}

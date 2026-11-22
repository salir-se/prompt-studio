// @module-tag pure
import { describe, expect, it } from 'vitest';
import type { SSEEvent, StreamCallbacks } from './sse-parser';
import { AnthropicStreamError, parseSSEStream, processAnthropicEvent } from './sse-parser';

// ── Helper to create a fake Response with a ReadableStream body ──────────────

function makeStreamResponse(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
  return { body: stream } as unknown as Response;
}

async function collectEvents(response: Response, signal?: AbortSignal): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of parseSSEStream(response, signal)) {
    events.push(event);
  }
  return events;
}

// ── parseSSEStream tests ─────────────────────────────────────────────────────

describe('parseSSEStream', () => {
  it('parses a single event', async () => {
    const response = makeStreamResponse('event: message_start\ndata: {"type":"message_start"}\n\n');

    const events = await collectEvents(response);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('message_start');
    expect(events[0].data).toBe('{"type":"message_start"}');
  });

  it('parses multiple events in a single chunk', async () => {
    const response = makeStreamResponse(
      'event: message_start\ndata: {"type":"start"}\n\nevent: content_block_delta\ndata: {"type":"delta"}\n\n',
    );

    const events = await collectEvents(response);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('message_start');
    expect(events[1].event).toBe('content_block_delta');
  });

  it('handles events split across multiple chunks', async () => {
    const response = makeStreamResponse('event: mess', 'age_start\ndata: {"type":"start"}\n\n');

    const events = await collectEvents(response);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('message_start');
    expect(events[0].data).toBe('{"type":"start"}');
  });

  it('stops on [DONE] data', async () => {
    const response = makeStreamResponse(
      'event: message_start\ndata: {"type":"start"}\n\nevent: done\ndata: [DONE]\n\nevent: extra\ndata: {"extra":"true"}\n\n',
    );

    const events = await collectEvents(response);
    expect(events).toHaveLength(1); // Only the event before [DONE]
  });

  it('uses "message" as default event name when no event line precedes data', async () => {
    const response = makeStreamResponse('data: {"type":"unknown"}\n\n');

    const events = await collectEvents(response);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('message');
  });

  it('resets event name on empty line (SSE spec)', async () => {
    const response = makeStreamResponse('event: special\ndata: {"id":1}\n\n\ndata: {"id":2}\n\n');

    const events = await collectEvents(response);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('special');
    // After empty line, event name should be reset to default
    expect(events[1].event).toBe('message');
  });

  it('handles abort signal', async () => {
    const controller = new AbortController();
    // Create a stream that would produce many events
    const response = makeStreamResponse('event: e1\ndata: {"id":1}\n\n', 'event: e2\ndata: {"id":2}\n\n');

    // Abort before collecting
    controller.abort();
    const events = await collectEvents(response, controller.signal);
    // Should stop immediately, getting 0 events
    expect(events.length).toBeLessThanOrEqual(1);
  });

  it('flushes remaining buffer at end of stream', async () => {
    // Stream that ends without a trailing newline
    const response = makeStreamResponse('data: {"final":"true"}');

    const events = await collectEvents(response);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"final":"true"}');
  });

  it('ignores non-event, non-data lines', async () => {
    const response = makeStreamResponse('id: 123\nretry: 5000\nevent: test\ndata: {"ok":true}\n\n');

    const events = await collectEvents(response);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('test');
  });

  it('handles empty stream', async () => {
    const response = makeStreamResponse('');
    const events = await collectEvents(response);
    expect(events).toHaveLength(0);
  });
});

function makeCallbacks() {
  const calls: Record<string, unknown[]> = {
    onToken: [],
    onThinking: [],
    onToolCallStart: [],
    onToolCallDelta: [],
    onUsage: [],
    onStop: [],
    onSignature: [],
    onRedactedThinking: [],
    onMessageStop: [],
  };
  const callbacks: StreamCallbacks = {
    onToken: (text) => calls.onToken.push(text),
    onThinking: (text) => calls.onThinking.push(text),
    onToolCallStart: (name, id) => calls.onToolCallStart.push({ name, id }),
    onToolCallDelta: (id, delta) => calls.onToolCallDelta.push({ id, delta }),
    onUsage: (inp, out, cacheCreation, cacheRead) => calls.onUsage.push({ inp, out, cacheCreation, cacheRead }),
    onStop: (reason) => calls.onStop.push(reason),
    onSignature: (signature) => calls.onSignature.push(signature),
    onRedactedThinking: (data) => calls.onRedactedThinking.push(data),
    onMessageStop: () => calls.onMessageStop.push(true),
  };
  return { calls, callbacks };
}

describe('processAnthropicEvent', () => {
  it('handles message_start with usage', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'message_start',
      data: JSON.stringify({
        type: 'message_start',
        message: { usage: { input_tokens: 100 } },
      }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onUsage).toEqual([{ inp: 100, out: 0 }]);
  });

  // Issue #1085 (Phase 0): Anthropic reports the prompt-cache breakdown once,
  // on message_start — never incrementally on message_delta.
  it('passes cache_creation_input_tokens/cache_read_input_tokens from message_start.usage', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'message_start',
      data: JSON.stringify({
        type: 'message_start',
        message: { usage: { input_tokens: 100, cache_creation_input_tokens: 800, cache_read_input_tokens: 1200 } },
      }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onUsage).toEqual([{ inp: 100, out: 0, cacheCreation: 800, cacheRead: 1200 }]);
  });

  it('leaves cache fields undefined on message_start when the provider omits them', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'message_start',
      data: JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 100 } } }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onUsage[0]).toMatchObject({ inp: 100, out: 0 });
    expect((calls.onUsage[0] as { cacheCreation?: number }).cacheCreation).toBeUndefined();
    expect((calls.onUsage[0] as { cacheRead?: number }).cacheRead).toBeUndefined();
  });

  it('handles content_block_delta with text', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' },
      }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onToken).toEqual(['Hello']);
  });

  it('handles content_block_delta with thinking', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'Let me think...' },
      }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onThinking).toEqual(['Let me think...']);
  });

  it('handles content_block_start for tool_use', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'web_search', id: 'tool-1' },
      }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onToolCallStart).toEqual([{ name: 'web_search', id: 'tool-1' }]);
  });

  it('handles message_delta with stop_reason', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'message_delta',
      data: JSON.stringify({
        type: 'message_delta',
        usage: { output_tokens: 50 },
        delta: { stop_reason: 'end_turn' },
      }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onUsage).toEqual([{ inp: 0, out: 50 }]);
    expect(calls.onStop).toEqual(['end_turn']);
  });

  it('ignores malformed JSON gracefully', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = { event: 'message', data: 'not json' };

    // Should not throw
    processAnthropicEvent(event, callbacks);
    expect(calls.onToken).toEqual([]);
  });

  it('handles input_json_delta for tool arguments', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"query":' },
      }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onToolCallDelta).toEqual([{ id: '1', delta: '{"query":' }]);
  });

  it('handles content_block_delta with signature_delta', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'signature_delta', signature: 'sig-abc123' },
      }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onSignature).toEqual(['sig-abc123']);
  });

  it('handles content_block_start for redacted_thinking', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'redacted_thinking', data: 'encrypted-blob-xyz' },
      }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onRedactedThinking).toEqual(['encrypted-blob-xyz']);
  });

  it('treats content_block_start for thinking as a safe no-op', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'thinking', thinking: '' },
      }),
    };

    expect(() => processAnthropicEvent(event, callbacks)).not.toThrow();
    expect(calls.onThinking).toEqual([]);
    expect(calls.onToolCallStart).toEqual([]);
    expect(calls.onSignature).toEqual([]);
    expect(calls.onRedactedThinking).toEqual([]);
  });

  it('does not throw on signature_delta when onSignature is not provided', () => {
    const { callbacks } = makeCallbacks();
    const partialCallbacks: StreamCallbacks = { ...callbacks, onSignature: undefined };
    const event: SSEEvent = {
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'signature_delta', signature: 'sig-abc123' },
      }),
    };

    expect(() => processAnthropicEvent(event, partialCallbacks)).not.toThrow();
  });

  it('regression: content_block_delta with thinking still routes to onThinking unchanged', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'Still thinking...' },
      }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onThinking).toEqual(['Still thinking...']);
    expect(calls.onSignature).toEqual([]);
    expect(calls.onRedactedThinking).toEqual([]);
  });

  it('#1824 F1b: fires onMessageStop on a real message_stop event', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) };

    processAnthropicEvent(event, callbacks);
    expect(calls.onMessageStop).toEqual([true]);
  });

  it('#1824 F1b: does not fire onMessageStop for a non-message_stop event', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'content_block_delta',
      data: JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onMessageStop).toEqual([]);
  });
});

// ── #1824 F1a: mid-stream `error` events ────────────────────────────────────

describe('processAnthropicEvent — #1824 F1a: mid-stream error events', () => {
  it('throws AnthropicStreamError carrying the upstream type and message for overloaded_error', () => {
    const { callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'error',
      data: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    };

    let caught: unknown;
    try {
      processAnthropicEvent(event, callbacks);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AnthropicStreamError);
    const err = caught as AnthropicStreamError;
    expect(err.errorType).toBe('overloaded_error');
    expect(err.message).toContain('Overloaded');
    // Classifiable as transient the same way a non-streaming 529 is (D7's
    // isOverloadStatus reads LlmHttpError#status — AnthropicStreamError IS one).
    expect(err.status).toBe(529);
  });

  it('maps rate_limit_error to status 429, matching the non-streaming HTTP classification', () => {
    const { callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'error',
      data: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }),
    };

    expect(() => processAnthropicEvent(event, callbacks)).toThrow(AnthropicStreamError);
    try {
      processAnthropicEvent(event, callbacks);
    } catch (err) {
      expect((err as AnthropicStreamError).status).toBe(429);
    }
  });

  it('does not silently drop the error event as an unrecognized type (no callbacks fire)', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'error',
      data: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    };

    expect(() => processAnthropicEvent(event, callbacks)).toThrow();
    expect(calls.onToken).toEqual([]);
    expect(calls.onStop).toEqual([]);
  });
});

// ── #1824 F2: input_tokens correction from message_delta ───────────────────

describe('processAnthropicEvent — #1824 F2: message_delta usage', () => {
  it('passes message_delta.usage.input_tokens through to onUsage (some vendors report the real count there)', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'message_delta',
      data: JSON.stringify({
        type: 'message_delta',
        usage: { input_tokens: 42, output_tokens: 10 },
        delta: { stop_reason: 'end_turn' },
      }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onUsage).toEqual([{ inp: 42, out: 10 }]);
  });

  it('leaves message_delta.usage.input_tokens at 0 when the vendor omits it (unchanged pre-#1824 shape)', () => {
    const { calls, callbacks } = makeCallbacks();
    const event: SSEEvent = {
      event: 'message_delta',
      data: JSON.stringify({ type: 'message_delta', usage: { output_tokens: 50 }, delta: { stop_reason: 'end_turn' } }),
    };

    processAnthropicEvent(event, callbacks);
    expect(calls.onUsage).toEqual([{ inp: 0, out: 50 }]);
  });
});

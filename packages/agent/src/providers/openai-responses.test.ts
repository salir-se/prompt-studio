// @module-tag pure
import type { ToolDefinition } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import {
  buildResponsesBody,
  fromResponsesResponse,
  ResponsesStreamAccumulator,
  toResponsesInput,
  toResponsesTools,
} from './openai-responses';

const TOOLS = [
  { name: 'save_lead', description: 'Save a lead', input_schema: { type: 'object', properties: {} } },
] as unknown as ToolDefinition[];

function body(overrides: Partial<Parameters<typeof buildResponsesBody>[0]> = {}) {
  return buildResponsesBody({
    model: 'gpt-5.6-terra',
    systemPrompt: 'You are Scout.',
    messages: [{ role: 'user', content: 'find leads' }],
    tools: TOOLS,
    maxTokens: 32_768,
    ...overrides,
  });
}

describe('buildResponsesBody', () => {
  it('maps the system prompt to instructions, not a leading message', () => {
    const result = body();
    expect(result.instructions).toBe('You are Scout.');
    expect(result.input).toEqual([{ role: 'user', content: 'find leads' }]);
  });

  it('uses max_output_tokens, never max_tokens or max_completion_tokens', () => {
    const result = body();
    expect(result.max_output_tokens).toBe(32_768);
    expect(result.max_tokens).toBeUndefined();
    expect(result.max_completion_tokens).toBeUndefined();
  });

  it('emits FLAT function tools, not the Chat Completions nested shape', () => {
    expect(body().tools).toEqual([
      {
        type: 'function',
        name: 'save_lead',
        description: 'Save a lead',
        parameters: { type: 'object', properties: {} },
      },
    ]);
  });

  it('sends reasoning.effort when an effort is requested', () => {
    expect(body({ reasoningEffort: 'high' }).reasoning).toEqual({ effort: 'high' });
  });

  it("omits the reasoning object entirely for 'none' and for an unset effort", () => {
    // On this endpoint "no reasoning object" means the model's own default,
    // which is the whole reason we route here — sending `{effort:'none'}`
    // would suppress the reasoning we came for.
    expect(body({ reasoningEffort: 'none' }).reasoning).toBeUndefined();
    expect(body({ reasoningEffort: undefined }).reasoning).toBeUndefined();
  });

  it('only sets stream when streaming', () => {
    expect(body().stream).toBeUndefined();
    expect(body({ stream: true }).stream).toBe(true);
  });

  it('only sets store when the caller explicitly chooses a persistence policy', () => {
    expect(body().store).toBeUndefined();
    expect(body({ store: false }).store).toBe(false);
  });

  it('omits tools entirely when there are none', () => {
    expect(body({ tools: [] }).tools).toBeUndefined();
  });
});

describe('toResponsesTools', () => {
  it('drops server-side tools that carry no description (e.g. web_search)', () => {
    const mixed = [...TOOLS, { type: 'web_search_20250305', name: 'web_search' }] as unknown as ToolDefinition[];
    expect(toResponsesTools(mixed)).toHaveLength(1);
  });
});

describe('toResponsesInput', () => {
  it('round-trips a tool call through call_id so the next turn pairs up', () => {
    // The agent loop replays this exact shape on every iteration; if the id
    // that comes back as `call_id` is not the id we send as `call_id`, the
    // following turn 400s on an unmatched function_call_output.
    const input = toResponsesInput([
      { role: 'user', content: 'find leads' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking now.' },
          { type: 'tool_use', id: 'call_abc', name: 'save_lead', input: { company: 'Acme' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_abc', content: 'saved' }] },
    ]);

    expect(input).toEqual([
      { role: 'user', content: 'find leads' },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Looking now.' }] },
      { type: 'function_call', call_id: 'call_abc', name: 'save_lead', arguments: '{"company":"Acme"}' },
      { type: 'function_call_output', call_id: 'call_abc', output: 'saved' },
    ]);
  });

  it('emits the function_call before the function_call_output that answers it', () => {
    const input = toResponsesInput([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 't', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }] },
    ]) as Array<{ type?: string }>;
    expect(input.findIndex((i) => i.type === 'function_call')).toBeLessThan(
      input.findIndex((i) => i.type === 'function_call_output'),
    );
  });

  it('uses output_text for assistant content (input_text is rejected for that role)', () => {
    expect(toResponsesInput([{ role: 'assistant', content: 'hello' }])).toEqual([
      { role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
    ]);
  });

  it('keeps prose that accompanies tool results, after the results', () => {
    const input = toResponsesInput([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'saved' },
          { type: 'text', text: 'now draft the email' },
        ],
      },
    ]);
    expect(input).toEqual([
      { type: 'function_call_output', call_id: 'call_1', output: 'saved' },
      { role: 'user', content: 'now draft the email' },
    ]);
  });

  it('converts a legacy top-level tool message', () => {
    expect(toResponsesInput([{ role: 'tool', tool_use_id: 'call_9', content: 'result' }])).toEqual([
      { type: 'function_call_output', call_id: 'call_9', output: 'result' },
    ]);
  });

  it('drops an assistant turn that carried no text and no tool call', () => {
    expect(toResponsesInput([{ role: 'assistant', content: [] }])).toEqual([]);
  });
});

describe('fromResponsesResponse', () => {
  it('maps call_id (not the fc_ item id) onto the tool_use block id', () => {
    const result = fromResponsesResponse({
      output: [{ type: 'function_call', id: 'fc_item', call_id: 'call_real', name: 'save_lead', arguments: '{"a":1}' }],
      usage: { input_tokens: 10, output_tokens: 20 },
      status: 'completed',
    });

    expect(result.content).toEqual([{ type: 'tool_use', id: 'call_real', name: 'save_lead', input: { a: 1 } }]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it('#1661: maps input_tokens_details.cached_tokens onto cacheReadInputTokens', () => {
    const result = fromResponsesResponse({
      output: [],
      usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 80 } },
      status: 'completed',
    });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 80 });
  });

  it("reports stopReason 'tool_use' so the runner keeps looping", () => {
    const result = fromResponsesResponse({
      output: [{ type: 'function_call', call_id: 'c', name: 't', arguments: '{}' }],
      status: 'completed',
    });
    expect(result.stopReason).toBe('tool_use');
  });

  it("reports 'end_turn' for a plain text answer", () => {
    const result = fromResponsesResponse({
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }],
      status: 'completed',
    });
    expect(result.content).toEqual([{ type: 'text', text: 'done' }]);
    expect(result.stopReason).toBe('end_turn');
  });

  it("maps an output-token truncation to 'max_tokens'", () => {
    const result = fromResponsesResponse({
      output: [],
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    });
    expect(result.stopReason).toBe('max_tokens');
  });

  it('surfaces reasoning summaries as thinking blocks', () => {
    const result = fromResponsesResponse({
      output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'weighing options' }] }],
      status: 'completed',
    });
    expect(result.content).toEqual([{ type: 'thinking', thinking: 'weighing options' }]);
  });

  it('keeps a tool call dispatchable when its arguments are unparseable', () => {
    const result = fromResponsesResponse({
      output: [{ type: 'function_call', call_id: 'c', name: 't', arguments: '{not json' }],
      status: 'completed',
    });
    expect(result.content[0]).toMatchObject({ type: 'tool_use', input: {} });
  });

  it('defaults usage to zero when the payload omits it', () => {
    expect(fromResponsesResponse({ output: [], status: 'completed' }).usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});

describe('ResponsesStreamAccumulator', () => {
  it('assembles text, tool calls and usage from the SSE event sequence', () => {
    const tokens: string[] = [];
    const started: string[] = [];
    const acc = new ResponsesStreamAccumulator({
      onToken: (t) => tokens.push(t),
      onToolCallStart: (name) => started.push(name),
    });

    acc.handleEvent({ type: 'response.created' });
    acc.handleEvent({ type: 'response.output_text.delta', output_index: 0, delta: 'Hel' });
    acc.handleEvent({ type: 'response.output_text.delta', output_index: 0, delta: 'lo' });
    acc.handleEvent({
      type: 'response.output_item.added',
      output_index: 1,
      item: { type: 'function_call', call_id: 'call_1', name: 'save_lead' },
    });
    acc.handleEvent({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"a"' });
    acc.handleEvent({ type: 'response.function_call_arguments.delta', output_index: 1, delta: ':1}' });
    acc.handleEvent({ type: 'response.completed', response: { usage: { input_tokens: 5, output_tokens: 7 } } });

    const result = acc.finalize();
    expect(tokens).toEqual(['Hel', 'lo']);
    expect(started).toEqual(['save_lead']);
    expect(result.content).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', id: 'call_1', name: 'save_lead', input: { a: 1 } },
    ]);
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
    expect(result.stopReason).toBe('tool_use');
  });

  it('keeps two interleaved calls to the SAME tool in separate argument buffers', () => {
    const acc = new ResponsesStreamAccumulator();
    acc.handleEvent({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', call_id: 'call_a', name: 'save_lead' },
    });
    acc.handleEvent({
      type: 'response.output_item.added',
      output_index: 1,
      item: { type: 'function_call', call_id: 'call_b', name: 'save_lead' },
    });
    // Fragments arrive interleaved — the failure mode `StreamedToolCalls` exists for.
    acc.handleEvent({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"n":' });
    acc.handleEvent({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"n":' });
    acc.handleEvent({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '1}' });
    acc.handleEvent({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '2}' });
    acc.handleEvent({ type: 'response.completed', response: { usage: {} } });

    expect(acc.finalize().content).toEqual([
      { type: 'tool_use', id: 'call_a', name: 'save_lead', input: { n: 1 } },
      { type: 'tool_use', id: 'call_b', name: 'save_lead', input: { n: 2 } },
    ]);
  });

  it('streams reasoning summaries through onThinking', () => {
    const thinking: string[] = [];
    const acc = new ResponsesStreamAccumulator({ onThinking: (t) => thinking.push(t) });
    acc.handleEvent({ type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'step 1' });
    acc.handleEvent({ type: 'response.reasoning_summary_text.delta', output_index: 0, delta: ' then 2' });
    acc.handleEvent({ type: 'response.completed', response: { usage: {} } });

    expect(thinking).toEqual(['step 1', ' then 2']);
    expect(acc.finalize().content).toEqual([{ type: 'thinking', thinking: 'step 1 then 2' }]);
  });

  it('reads usage only from the terminal event, never from an in-flight envelope', () => {
    const acc = new ResponsesStreamAccumulator();
    acc.handleEvent({ type: 'response.in_progress', response: { usage: { input_tokens: 999, output_tokens: 999 } } });
    acc.handleEvent({ type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 2 } } });
    expect(acc.finalize().usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it("maps an incomplete terminal event to 'max_tokens'", () => {
    const acc = new ResponsesStreamAccumulator();
    acc.handleEvent({
      type: 'response.incomplete',
      response: { usage: {}, incomplete_details: { reason: 'max_output_tokens' } },
    });
    expect(acc.finalize().stopReason).toBe('max_tokens');
  });

  it('records a mid-flight failure instead of returning a silently empty turn', () => {
    const acc = new ResponsesStreamAccumulator();
    acc.handleEvent({ type: 'response.failed', response: { error: { message: 'upstream exploded' } } });
    expect(acc.streamError).toBe('upstream exploded');
  });

  it('ignores unknown event types so new OpenAI events cannot break the parser', () => {
    const acc = new ResponsesStreamAccumulator();
    expect(() => acc.handleEvent({ type: 'response.some_future_event', payload: {} })).not.toThrow();
    expect(acc.finalize().content).toEqual([]);
  });
});

// @module-tag pure
import type { ToolDefinition } from '@prompt-studio/prompts';
import { describe, expect, it, vi } from 'vitest';
import type { LlmChatRequest, LlmChatResponse, LlmProvider } from './provider';
import { OneShotTruncatedError, runAgent, runOneShot, TOOL_RESULT_MAX_BYTES } from './tool-loop';

/** A scripted provider: each `chat` call returns the next queued response and records the request. */
function scriptedProvider(responses: readonly LlmChatResponse[]) {
  const queue = [...responses];
  const chat = vi.fn(async (_request: LlmChatRequest): Promise<LlmChatResponse> => {
    const next = queue.shift();
    if (!next) throw new Error('scripted provider ran out of responses');
    return next;
  });
  const provider: LlmProvider = {
    id: 'scripted',
    name: 'Scripted',
    chat,
    chatStream: async () => {
      throw new Error('not used');
    },
    testConnection: async () => ({ ok: true }) as never,
  };
  return { provider, chat };
}

function textReply(text: string, stopReason = 'end_turn', usage = { inputTokens: 10, outputTokens: 5 }) {
  return { content: [{ type: 'text', text }], usage, stopReason } satisfies LlmChatResponse;
}

function toolReply(calls: readonly { id: string; name: string; input?: Record<string, unknown> }[]) {
  return {
    content: calls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input ?? {} })),
    usage: { inputTokens: 20, outputTokens: 8 },
    stopReason: 'tool_use',
  } satisfies LlmChatResponse;
}

const LOOKUP_TOOL: ToolDefinition = {
  name: 'lookup_customer',
  description: 'Find a customer by email address.',
  input_schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
} as ToolDefinition;

const BASE = {
  systemPrompt: 'You route one customer message for Example Co.',
  userMessage: 'I was charged twice this month.',
  request: { model: 'test-model', maxTokens: 256 },
} as const;

describe('runOneShot', () => {
  it('sends one request without tools and returns the reply text with its token usage', async () => {
    // Given: a provider that answers with plain text
    const { provider, chat } = scriptedProvider([textReply('{"category":"billing"}')]);

    // When: a one-shot request runs
    const reply = await runOneShot({ ...BASE, provider, runId: 'run-1' });

    // Then: the reply carries the text and usage, and exactly one tool-free request was sent
    expect(reply).toEqual({ runId: 'run-1', text: '{"category":"billing"}', inputTokens: 10, outputTokens: 5 });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0]).toMatchObject({
      model: 'test-model',
      maxTokens: 256,
      systemPrompt: BASE.systemPrompt,
      messages: [{ role: 'user', content: BASE.userMessage }],
      tools: [],
    });
  });

  it('throws OneShotTruncatedError with the partial text when the model stops at max_tokens', async () => {
    // Given: a provider whose reply was cut at the token limit
    const { provider } = scriptedProvider([
      textReply('{"category":"bil', 'max_tokens', { inputTokens: 9, outputTokens: 256 }),
    ]);

    // When: a one-shot request runs
    const outcome = runOneShot({ ...BASE, provider });

    // Then: the truncation surfaces as a typed error carrying the partial text and output tokens
    await expect(outcome).rejects.toBeInstanceOf(OneShotTruncatedError);
    await expect(outcome).rejects.toMatchObject({ partialText: '{"category":"bil', outputTokens: 256 });
  });

  it('refuses to send a request once the caller has aborted', async () => {
    // Given: an already aborted signal
    const { provider, chat } = scriptedProvider([textReply('unused')]);
    const controller = new AbortController();
    controller.abort();

    // When / Then: the one-shot call rejects and the provider is never called
    await expect(runOneShot({ ...BASE, provider, signal: controller.signal })).rejects.toThrow();
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('runAgent', () => {
  it('returns the text of a reply that asks for no tool', async () => {
    // Given: a provider that answers directly
    const { provider, chat } = scriptedProvider([textReply('Category: billing.')]);
    const dispatchTool = vi.fn();

    // When: the agent loop runs with a tool available
    const result = await runAgent({ ...BASE, provider, tools: [LOOKUP_TOOL], dispatchTool, runId: 'run-2' });

    // Then: it completes after one request, offering the tool, without dispatching anything
    expect(result).toEqual({
      runId: 'run-2',
      status: 'completed',
      result: 'Category: billing.',
      iterations: 1,
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(chat.mock.calls[0][0].tools).toEqual([LOOKUP_TOOL]);
    expect(dispatchTool).not.toHaveBeenCalled();
  });

  it('dispatches a tool call and sends its JSON result back as a tool_result block', async () => {
    // Given: a model that calls lookup_customer once, then answers
    const { provider, chat } = scriptedProvider([
      toolReply([{ id: 'call-1', name: 'lookup_customer', input: { email: 'ada@example.test' } }]),
      textReply('Billing, high urgency.'),
    ]);
    const dispatchTool = vi.fn(async () => ({ plan: 'team', open_invoices: 2 }));

    // When: the agent loop runs
    const result = await runAgent({ ...BASE, provider, tools: [LOOKUP_TOOL], dispatchTool });

    // Then: the tool received the model's input, and the second request replays the assistant turn plus the result
    expect(dispatchTool).toHaveBeenCalledWith('lookup_customer', { email: 'ada@example.test' }, undefined);
    expect(result).toMatchObject({ status: 'completed', result: 'Billing, high urgency.', iterations: 2 });
    expect(result.inputTokens).toBe(30);
    expect(result.outputTokens).toBe(13);
    const secondMessages = chat.mock.calls[1][0].messages;
    expect(secondMessages).toHaveLength(3);
    expect(secondMessages[1]).toEqual({
      role: 'assistant',
      content: toolReply([{ id: 'call-1', name: 'lookup_customer', input: { email: 'ada@example.test' } }]).content,
    });
    expect(secondMessages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '{"plan":"team","open_invoices":2}' }],
    });
  });

  it('caps an oversized tool result before sending it back', async () => {
    // Given: a tool whose JSON result is larger than the cap
    const { provider, chat } = scriptedProvider([
      toolReply([{ id: 'call-1', name: 'lookup_customer' }]),
      textReply('done'),
    ]);
    const dispatchTool = vi.fn(async () => ({ notes: 'x'.repeat(TOOL_RESULT_MAX_BYTES + 100) }));

    // When: the agent loop runs
    await runAgent({ ...BASE, provider, tools: [LOOKUP_TOOL], dispatchTool });

    // Then: the replayed result is cut and says so
    const [block] = chat.mock.calls[1][0].messages[2].content as { content: string }[];
    expect(block.content).toContain(`[truncated: the tool result exceeded ${TOOL_RESULT_MAX_BYTES} bytes]`);
    expect(new TextEncoder().encode(block.content).byteLength).toBeLessThan(TOOL_RESULT_MAX_BYTES + 100);
  });

  it('turns a failing tool into an is_error tool_result and keeps the run going', async () => {
    // Given: a tool that throws
    const { provider, chat } = scriptedProvider([
      toolReply([{ id: 'call-1', name: 'lookup_customer' }]),
      textReply('No customer found.'),
    ]);
    const dispatchTool = vi.fn(async () => {
      throw new Error('directory offline');
    });

    // When: the agent loop runs
    const result = await runAgent({ ...BASE, provider, tools: [LOOKUP_TOOL], dispatchTool });

    // Then: the model receives the failure as an error result and the run still completes
    expect(chat.mock.calls[1][0].messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call-1',
          content: JSON.stringify({ error: "Tool 'lookup_customer' failed: directory offline" }),
          is_error: true,
        },
      ],
    });
    expect(result).toMatchObject({ status: 'completed', result: 'No customer found.' });
  });

  it('stops with iteration_limit when the model keeps calling tools', async () => {
    // Given: a model that asks for a tool on every turn
    const { provider, chat } = scriptedProvider([
      toolReply([{ id: 'call-1', name: 'lookup_customer' }]),
      toolReply([{ id: 'call-2', name: 'lookup_customer' }]),
      toolReply([{ id: 'call-3', name: 'lookup_customer' }]),
    ]);
    const dispatchTool = vi.fn(async () => ({}));

    // When: the loop runs with a limit of two requests
    const result = await runAgent({ ...BASE, provider, tools: [LOOKUP_TOOL], dispatchTool, maxIterations: 2 });

    // Then: it stops after two requests with no result
    expect(result).toMatchObject({ status: 'iteration_limit', result: null, iterations: 2 });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('throws OneShotTruncatedError when a final reply is cut at max_tokens', async () => {
    // Given: a tool round trip followed by a reply cut at the token limit
    const { provider } = scriptedProvider([
      toolReply([{ id: 'call-1', name: 'lookup_customer' }]),
      textReply('Billing, hi', 'length', { inputTokens: 30, outputTokens: 256 }),
    ]);

    // When: the agent loop runs
    const outcome = runAgent({ ...BASE, provider, tools: [LOOKUP_TOOL], dispatchTool: async () => ({}) });

    // Then: the truncation surfaces with the partial text and the run's total output tokens
    await expect(outcome).rejects.toBeInstanceOf(OneShotTruncatedError);
    await expect(outcome).rejects.toMatchObject({ partialText: 'Billing, hi', outputTokens: 264 });
  });

  it('cannot dispatch a requested tool after the caller aborts', async () => {
    // Given: a caller that aborts while the model's tool request is in flight
    const controller = new AbortController();
    const { provider, chat } = scriptedProvider([toolReply([{ id: 'call-1', name: 'lookup_customer' }])]);
    chat.mockImplementationOnce(async () => {
      controller.abort();
      return toolReply([{ id: 'call-1', name: 'lookup_customer' }]);
    });
    const dispatchTool = vi.fn(async () => ({}));

    // When: the agent loop runs
    const result = await runAgent({ ...BASE, provider, tools: [LOOKUP_TOOL], dispatchTool, signal: controller.signal });

    // Then: the run ends as aborted and the tool never runs
    expect(result).toMatchObject({ status: 'aborted', result: null, iterations: 1 });
    expect(dispatchTool).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('sends no request when the caller aborted before the run started', async () => {
    // Given: an already aborted signal
    const controller = new AbortController();
    controller.abort();
    const { provider, chat } = scriptedProvider([textReply('unused')]);

    // When: the agent loop runs
    const result = await runAgent({
      ...BASE,
      provider,
      tools: [],
      dispatchTool: async () => ({}),
      signal: controller.signal,
    });

    // Then: it reports aborted without calling the provider
    expect(result).toMatchObject({ status: 'aborted', iterations: 0 });
    expect(chat).not.toHaveBeenCalled();
  });
});

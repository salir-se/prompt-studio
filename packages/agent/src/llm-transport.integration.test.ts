// @module-tag integration
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLlmTransport, LlmTransportError, type LlmTransportRequest } from './llm-transport';
import { llmOverloadGuard } from './overload-guard';
import type { LlmChatRequest } from './provider';
import { createAnthropicProvider } from './providers/anthropic';
import { createOpenAICompatProvider } from './providers/openai-compat';
import { stalledJsonFetch, stalledStreamFetch } from './request-lifetime.test-helper';
import { fetchWithTransientRetry } from './transient-retry';

const nativeFetch = vi.fn<typeof fetch>();
const context = { agent: 'support-triage', runId: 'run-1', leadId: 'lead-1' };
const chatRequest: LlmChatRequest = {
  model: 'test-model',
  systemPrompt: 'Exact private system text',
  messages: [{ role: 'user', content: 'Exact private user text' }],
  tools: [],
  transportContext: context,
};
const retry = { maxAttempts: 2, sleep: async () => {}, baseDelayMs: 1 };
const anthropic = () =>
  Response.json({
    content: [{ type: 'text', text: 'done' }],
    usage: { input_tokens: 1, output_tokens: 2 },
    stop_reason: 'end_turn',
  });
const openai = () =>
  Response.json({
    choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 2 },
  });
const stream = (wire: 'anthropic' | 'openai') =>
  new Response(
    wire === 'anthropic'
      ? 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
      : 'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
let dispose: (() => void) | undefined;
let captured: LlmTransportRequest[];
beforeEach(() => {
  nativeFetch.mockReset();
  vi.stubGlobal('fetch', nativeFetch);
  vi.stubEnv('VITE_TEST_MODE', 'false');
  llmOverloadGuard.reset();
  llmOverloadGuard.setMode('observe');
  captured = [];
});
afterEach(() => {
  dispose?.();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function capture(): void {
  dispose = installLlmTransport(async (request, send) => {
    captured.push(request);
    return send();
  });
}

describe('LLM attempt coverage', () => {
  it.each(['anthropic', 'openai'] as const)('captures native network retries for %s', async (wire) => {
    capture();
    nativeFetch.mockRejectedValueOnce(new TypeError('offline'));
    nativeFetch.mockResolvedValueOnce(wire === 'anthropic' ? anthropic() : openai());
    const provider =
      wire === 'anthropic'
        ? createAnthropicProvider({ apiKey: 'private-key', retry })
        : createOpenAICompatProvider({ apiKey: 'private-key', baseUrl: 'https://provider.test', retry });
    await provider.chat(chatRequest);
    expect(captured).toHaveLength(2);
    expect(captured[0]).toEqual(captured[1]);
    expect(captured[0]?.context).toEqual(context);
    expect(captured[0]?.body).toBe(nativeFetch.mock.calls[0]?.[1]?.body);
  });

  it.each(['anthropic', 'openai'] as const)('preserves %s streaming tokens through the handler', async (wire) => {
    capture();
    nativeFetch.mockResolvedValueOnce(stream(wire));
    const provider =
      wire === 'anthropic'
        ? createAnthropicProvider({ apiKey: 'private-key' })
        : createOpenAICompatProvider({ apiKey: 'private-key', baseUrl: 'https://provider.test' });
    const onToken = vi.fn();
    await provider.chatStream(chatRequest, { onToken });
    expect(onToken).toHaveBeenCalledWith('done');
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0]!.body).stream).toBe(true);
  });

  it('captures effective Responses and fallback requests before the secret-bearing proxy envelope', async () => {
    capture();
    nativeFetch.mockResolvedValueOnce(new Response('unsupported endpoint', { status: 404 }));
    nativeFetch.mockResolvedValueOnce(openai());
    const provider = createOpenAICompatProvider(
      {
        apiKey: 'private-key',
        proxy: { url: 'https://proxy.test/llm', headers: { Authorization: 'Bearer private-session' } },
      },
      { id: 'openai', name: 'OpenAI' },
    );
    await provider.chat({
      ...chatRequest,
      model: 'gpt-5.6',
      tools: [{ name: 'query_data', description: 'Read', input_schema: { type: 'object', properties: {} } }],
    });
    expect(captured.map((r) => r.url)).toEqual([
      'https://api.openai.com/v1/responses',
      'https://api.openai.com/v1/chat/completions',
    ]);
    for (const [index, descriptor] of captured.entries()) {
      const envelope = JSON.parse(nativeFetch.mock.calls[index]![1]!.body as string);
      expect(descriptor.body).toBe(JSON.stringify(envelope.request));
      expect(descriptor.context).toEqual(context);
      expect(envelope.apiKey).toBe('private-key');
    }
    expect(JSON.stringify(captured)).not.toMatch(/private-key|private-session|proxy.test/);
  });

  it('replays a raw provider response without a native request', async () => {
    dispose = installLlmTransport(async () => anthropic());
    const result = await createAnthropicProvider({ apiKey: 'private-key' }).chat(chatRequest);
    expect(result.content).toEqual([{ type: 'text', text: 'done' }]);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it.each(['anthropic', 'openai'] as const)(
    'surfaces a disposed failing journal without retrying or degrading: %s',
    async (path) => {
      const handler = vi.fn(async () => {
        dispose?.();
        throw new TypeError('private journal failure');
      });
      dispose = installLlmTransport(handler);
      nativeFetch.mockResolvedValue(anthropic());
      const invoke = () => {
        if (path === 'anthropic') return createAnthropicProvider({ apiKey: 'private-key', retry }).chat(chatRequest);
        return createOpenAICompatProvider({ apiKey: 'private-key', retry }).chat(chatRequest);
      };
      await expect(invoke()).rejects.toBeInstanceOf(LlmTransportError);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(nativeFetch).not.toHaveBeenCalled();
    },
  );

  it('honors an explicit permanent fetch-stage failure before any retry', async () => {
    const failure = new Error('permanent');
    const doFetch = vi.fn(async () => {
      throw failure;
    });
    await expect(fetchWithTransientRetry(doFetch, { retry, isPermanentError: (err) => err === failure })).rejects.toBe(
      failure,
    );
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('labels connection probes independently of agent requests', async () => {
    capture();
    nativeFetch.mockImplementation(async () => anthropic());
    await createAnthropicProvider({ apiKey: 'private-key' }).testConnection();
    await createOpenAICompatProvider({ apiKey: 'private-key', baseUrl: 'https://provider.test' }).testConnection();
    expect(captured).toHaveLength(2);
    expect(captured.map((r) => r.context)).toEqual([{ agent: 'probe' }, { agent: 'probe' }]);
  });

  it('rejects opaque ChatGPT subscription capture before publishing an inaccurate upstream request', async () => {
    const handler = vi.fn(async () => stream('openai'));
    dispose = installLlmTransport(handler);
    const provider = createOpenAICompatProvider({
      apiKey: '',
      authMode: 'chatgpt-subscription',
      proxy: { url: 'https://proxy.test/subscription', headers: { Authorization: 'Bearer private-session' } },
      retry,
    });
    await expect(provider.chat(chatRequest)).rejects.toBeInstanceOf(LlmTransportError);
    expect(handler).not.toHaveBeenCalled();
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('leaves the opaque subscription transport unchanged while capture is inactive', async () => {
    nativeFetch.mockResolvedValueOnce(
      new Response(
        'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":2}}}\n\n',
      ),
    );
    const provider = createOpenAICompatProvider({
      apiKey: '',
      authMode: 'chatgpt-subscription',
      proxy: { url: 'https://proxy.test/subscription', headers: { Authorization: 'Bearer private-session' } },
      retry,
    });
    await expect(provider.chat(chatRequest)).resolves.toMatchObject({ stopReason: 'end_turn' });
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = nativeFetch.mock.calls[0]!;
    expect(url).toBe('https://proxy.test/subscription');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer private-session' });
    expect(JSON.parse(init?.body as string)).toMatchObject({
      authMode: 'chatgpt-subscription',
      request: { model: 'test-model', stream: true, store: false },
    });
  });

  it.each(['anthropic', 'openai'] as const)(
    'keeps caller cancellation and body lifetime active for %s',
    async (wire) => {
      capture();
      const caller = new AbortController();
      const stalled = stalledStreamFetch();
      nativeFetch.mockImplementationOnce((input, init) => stalled.fetch(input, init ?? {}));
      const provider =
        wire === 'anthropic'
          ? createAnthropicProvider({ apiKey: 'private-key', retry })
          : createOpenAICompatProvider({ apiKey: 'private-key', baseUrl: 'https://provider.test', retry });
      const outcome = provider.chatStream({ ...chatRequest, signal: caller.signal }, {}).catch((err) => err);
      try {
        await stalled.bodyStarted;
        caller.abort();
        const error = await outcome;
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('cancelled');
        expect(stalled.requestSignal().aborted).toBe(true);
        expect(captured).toHaveLength(1);
        expect(nativeFetch).toHaveBeenCalledTimes(1);
      } finally {
        stalled.settle();
        await outcome;
      }
    },
  );

  it('keeps the timeout live through body consumption with an installed transport', async () => {
    capture();
    const stalled = stalledJsonFetch();
    nativeFetch.mockImplementationOnce((input, init) => stalled.fetch(input, init ?? {}));
    const outcome = createAnthropicProvider({ apiKey: 'private-key', timeoutMs: 10, retry }).chat(chatRequest);
    try {
      await stalled.bodyStarted;
      // #1757: the timeout still reaches into body consumption with a transport installed — the
      // point of this test — but a spent budget is permanent now, so the journal records the one
      // attempt that was actually made rather than two identical ones.
      await expect(outcome).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(stalled.requestSignal().aborted).toBe(true);
      expect(captured).toHaveLength(1);
    } finally {
      stalled.settle();
      await outcome.catch(() => {});
    }
  });
});

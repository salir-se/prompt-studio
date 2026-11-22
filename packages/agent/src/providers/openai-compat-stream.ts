import { llmHttpStatus } from '../llm-http-error';
import { LlmTransportError } from '../llm-transport';
import { openaiCachedInputTokens } from '../openai-cached-tokens';
import { llmOverloadGuard } from '../overload-guard';
import type { LlmChatRequest, LlmChatResponse, LlmStreamCallbacks } from '../provider';
import { parseSSEStream } from '../sse-parser';
import { StreamedToolCalls } from '../streamed-tool-calls';
import type { ContentBlock } from '../types';
import {
  CHAT_COMPLETIONS_PATH,
  isResponsesEndpointUnusable,
  log,
  mapFinishReason,
  RESPONSES_PATH,
} from './openai-compat-format';
import type { OpenAIRequests } from './openai-compat-request';
import type { OpenAITransport } from './openai-compat-transport';
import { ResponsesStreamAccumulator } from './openai-responses';

export function createOpenAIStreams(requests: OpenAIRequests, transport: OpenAITransport) {
  const {
    providerMeta,
    usesChatGptSubscription,
    resolveModel,
    usesResponsesApi,
    buildResponsesRequestBody,
    buildBody,
    errorProviderName,
  } = requests;
  const { fetchOrThrow } = transport;
  /**
   * Record a Responses→Chat Completions degradation. Worth a warn rather than
   * a debug: the run survives, but it survives with the model's reasoning
   * switched off, and that is exactly the kind of silent quality loss the
   * operator needs to see in the logs before they see it in the output.
   */
  function logResponsesFallback(request: LlmChatRequest, err: unknown): void {
    log.warn(
      {
        provider: providerMeta.id,
        model: resolveModel(request),
        status: llmHttpStatus(err),
        err: err instanceof Error ? err.message : String(err),
      },
      'Responses API unavailable — retrying on chat completions with reasoning disabled (safe fallback)',
    );
  }

  /** Consume a streamed `/v1/responses` SSE body into one response. */
  async function streamResponsesApi(
    res: Response,
    request: LlmChatRequest,
    callbacks: LlmStreamCallbacks,
    onEvent: () => void,
  ): Promise<LlmChatResponse> {
    if (!res.body) throw new Error('No response body for streaming');

    const accumulator = new ResponsesStreamAccumulator({
      onToken: (text) => callbacks.onToken?.(text),
      onThinking: (text) => callbacks.onThinking?.(text),
      onToolCallStart: (name, id) => callbacks.onToolCallStart?.(name, id),
      onToolCallDelta: (id, delta) => callbacks.onToolCallDelta?.(id, delta),
      onUsage: (input, output) => callbacks.onUsage?.(input, output),
      onStop: (reason) => callbacks.onStop?.(reason),
    });

    for await (const event of parseSSEStream(res, request.signal)) {
      onEvent();
      if (request.signal?.aborted) throw new Error('Agent run was cancelled');
      try {
        accumulator.handleEvent(JSON.parse(event.data));
      } catch {
        // Skip unparseable chunks, matching the chat-completions stream.
      }
    }
    if (request.signal?.aborted) throw new Error('Agent run was cancelled');

    // A stream that opened 200 and then reported a failure mid-flight would
    // otherwise return a silently empty turn; surfacing it lets the runner's
    // retry and error paths see a real failure.
    const streamError = accumulator.streamError;
    if (streamError) throw new Error(`${errorProviderName()} streaming error: ${streamError}`);

    return accumulator.finalize((block) => log.warn({ tool: block.name }, 'Failed to parse streamed tool arguments'));
  }

  async function fetchResponsesStream(
    request: LlmChatRequest,
    callbacks: LlmStreamCallbacks,
  ): Promise<LlmChatResponse> {
    let streamStarted = false;
    const { value } = await fetchOrThrow(
      buildResponsesRequestBody(request, true),
      request.signal,
      RESPONSES_PATH,
      (res) => streamResponsesApi(res, request, callbacks, () => (streamStarted = true)),
      () => streamStarted,
      request.transportContext,
    );
    return value!;
  }

  async function chatStream(request: LlmChatRequest, callbacks: LlmStreamCallbacks): Promise<LlmChatResponse> {
    if (usesResponsesApi(request)) {
      try {
        const value = await fetchResponsesStream(request, callbacks);
        llmOverloadGuard.recordSuccess();
        return value;
      } catch (err) {
        if (err instanceof LlmTransportError || usesChatGptSubscription || !isResponsesEndpointUnusable(err)) throw err;
        logResponsesFallback(request, err);
      }
    }
    // Parse OpenAI SSE stream
    const content: ContentBlock[] = [];
    // Keyed by `tool_calls[].index` — the wire's own identity for a call, so
    // two calls to the same tool in one turn keep separate argument buffers
    // however the provider interleaves their fragments. See
    // streamed-tool-calls.ts.
    const toolCalls = new StreamedToolCalls();
    let inputTokens = 0;
    let outputTokens = 0;
    let streamCacheRead: number | undefined;
    let stopReason = 'end_turn';

    let streamStarted = false;
    await fetchOrThrow(
      buildBody(request, true),
      request.signal,
      CHAT_COMPLETIONS_PATH,
      async (res) => {
        streamStarted = false;

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body for streaming');

        const decoder = new TextDecoder();
        let buffer = '';
        const onAbort = (): void => {
          void reader.cancel().catch(() => {});
        };
        if (request.signal?.aborted) {
          await reader.cancel().catch(() => {});
          throw new Error('Agent run was cancelled');
        }
        request.signal?.addEventListener('abort', onAbort);

        try {
          while (true) {
            if (request.signal?.aborted) throw new Error('Agent run was cancelled');
            const { done, value } = await reader.read();
            if (request.signal?.aborted) throw new Error('Agent run was cancelled');
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed?.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              streamStarted = true;
              if (data === '[DONE]') continue;

              try {
                const chunk = JSON.parse(data);
                const delta = chunk.choices?.[0]?.delta;
                const finishReason = chunk.choices?.[0]?.finish_reason;

                if (delta?.content) {
                  const last = content[content.length - 1];
                  if (last && last.type === 'text') {
                    last.text = (last.text || '') + delta.content;
                  } else {
                    content.push({ type: 'text', text: delta.content });
                  }
                  callbacks.onToken?.(delta.content);
                }

                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    // `index` is what ties a fragment to its call. A provider
                    // that omits it (Google's real wire does — the reason this
                    // fallback exists at all) falls back to the wire's own
                    // `id`, which is stable across that call's fragments too,
                    // so an extra_content-only fragment and a later name-only
                    // fragment for the SAME call still resolve to the SAME
                    // entry. Only when NEITHER is present does identity fall
                    // through to `undefined`, which the accumulator resolves
                    // to the call still being built — the pre-index behavior,
                    // unchanged.
                    const key =
                      typeof tc.index === 'number' ? tc.index : typeof tc.id === 'string' && tc.id ? tc.id : undefined;
                    // Google's `thought_signature` (see `ContentBlock.providerExtra`)
                    // can arrive on the same fragment as the name, or on its
                    // own fragment with no name at all — open()/finalize()
                    // merge it onto the block either way.
                    const extraContent = tc.extra_content as Record<string, unknown> | undefined;
                    if (tc.function?.name || extraContent) {
                      // Only a truly anonymous fragment (no index, no id)
                      // falls through to this position-based key, and it must
                      // count OPENED entries (`toolCalls.size`), not
                      // `content.length`: an extra_content-only fragment opens
                      // a call without pushing it, so two such fragments (for
                      // two different calls) would otherwise both see
                      // `content.length === 0` and collapse into one entry —
                      // silently overwriting the first call's signature with
                      // the second's.
                      const { block, isNew } = toolCalls.open(
                        key ?? toolCalls.size,
                        tc.id,
                        tc.function?.name,
                        extraContent,
                      );
                      // Only the first sighting of a NAMED call pushes it into
                      // `content` (and fires onToolCallStart) — once, whichever
                      // fragment that name lands on. A provider that repeats
                      // the name on every fragment must not forge a phantom
                      // call per fragment, and an extra_content-only fragment
                      // that opened the entry before the name arrived must not
                      // be skipped once the name does.
                      const alreadyPushed = !isNew && content.includes(block);
                      if (tc.function?.name && !alreadyPushed) {
                        content.push(block);
                        callbacks.onToolCallStart?.(tc.function.name, block.id ?? '');
                      }
                    }
                    if (tc.function?.arguments) {
                      toolCalls.append(key, tc.function.arguments);
                      callbacks.onToolCallDelta?.(tc.id || toolCalls.idFor(key) || '', tc.function.arguments);
                    }
                  }
                }

                if (finishReason) {
                  stopReason = mapFinishReason(finishReason);
                  callbacks.onStop?.(stopReason);
                }

                // Usage in stream (OpenAI stream_options.include_usage)
                if (chunk.usage) {
                  inputTokens = chunk.usage.prompt_tokens || 0;
                  outputTokens = chunk.usage.completion_tokens || 0;
                  streamCacheRead = openaiCachedInputTokens(chunk.usage);
                  callbacks.onUsage?.(inputTokens, outputTokens);
                }
              } catch {
                // Skip unparseable chunks
              }
            }
          }
        } finally {
          request.signal?.removeEventListener('abort', onAbort);
          reader.releaseLock();
        }
      },
      () => streamStarted,
      request.transportContext,
    );
    llmOverloadGuard.recordSuccess();

    // Parse accumulated tool call arguments
    toolCalls.finalize((block) => log.warn({ tool: block.name }, 'Failed to parse streamed tool arguments'));

    return {
      content,
      usage:
        streamCacheRead === undefined
          ? { inputTokens, outputTokens }
          : { inputTokens, outputTokens, cacheReadInputTokens: streamCacheRead },
      stopReason,
    };
  }

  return { fetchResponsesStream, logResponsesFallback, chatStream };
}

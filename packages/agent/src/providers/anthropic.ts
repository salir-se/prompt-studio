/**
 * Anthropic Messages API provider.
 *
 * Wire format: POST /v1/messages
 * Auth: x-api-key header
 * Body: { model, max_tokens, system, tools, messages }
 * Response: { content: ContentBlock[], usage, stop_reason }
 *
 * This is Anthropic's native format. Only used when connecting
 * directly to api.anthropic.com (or a compatible proxy).
 */

import { compareServedModel, describeServedModel } from '../vendor/served-model';
import { createLogger } from '@prompt-studio/observability';
import {
  anthropicWireProxyFailureMessage,
  anthropicWireProxyHeaders,
  buildAnthropicWireProxyBody,
  hasSalirLlmUpstreamMarker,
} from '../anthropic-wire-proxy';
import { LlmHttpError } from '../llm-http-error';
import { fetchLlm, type LlmTransportContext, LlmTransportError } from '../llm-transport';
import { isOverloadStatus, llmOverloadGuard, parseRetryAfterMs } from '../overload-guard';
import { applyPromptCaching } from '../prompt-caching';
import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmProvider,
  LlmProviderConfig,
  LlmStreamCallbacks,
  LlmTestResult,
} from '../provider';
import { formatProviderErrorDetail } from '../provider-error-detail';
import { isLlmTimeout, readWithCallerCancellation, requestLifetime } from '../request-lifetime';
import type { StreamCallbacks } from '../sse-parser';
import { AnthropicStreamError, parseSSEStream, processAnthropicEvent } from '../sse-parser';
import { StreamedToolCalls } from '../streamed-tool-calls';
import { fetchWithTransientRetry, type TransientFetchAttempt } from '../transient-retry';
import type { ContentBlock } from '../types';

/** The Anthropic Messages response fields this provider reads (typed so a Workers `Response.json()` compiles too). */
interface AnthropicMessagesJson {
  content: ContentBlock[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  stop_reason: string;
  model?: string;
}

const log = createLogger('llm:anthropic');

const DEFAULT_MODEL = 'claude-sonnet-5';

// Anthropic returns 404 on POST /v1/messages when the `model` field
// references a retired or never-existed alias. Pre-existing user
// configs may still carry the old `claude-sonnet-4-*` dated names
// from before the 4.6 cutover. Rewrite known-retired strings at the
// request-build seam so a stored config doesn't strand the user
// behind a confusing 404 before they ever reach Settings to update
// it. The map is intentionally narrow — explicit hits only, no
// fuzzy matching.
const RETIRED_MODEL_ALIASES: Readonly<Record<string, string>> = {
  'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
};

function aliasModel(model: string): string {
  return RETIRED_MODEL_ALIASES[model] ?? model;
}
const API_VERSION = '2023-06-01';

export function createAnthropicProvider(
  config: LlmProviderConfig,
  meta: { id: string; name: string } = { id: 'anthropic', name: 'Anthropic' },
): LlmProvider {
  const baseUrl = config.baseUrl || 'https://api.anthropic.com';
  const defaultModel = config.model || DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs || 120_000;

  const isAnthropicDirect = baseUrl.includes('api.anthropic.com');

  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': API_VERSION,
    };
    // Required for browser-origin requests to api.anthropic.com.
    if (isAnthropicDirect) headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return headers;
  }

  function buildBody(request: LlmChatRequest, stream = false): string {
    // Issue #1085 (Phase 1): flag-gated, callers set `request.promptCaching`
    // from the `prompts.llm.prompt-caching` flag read at the app boundary.
    // Falsy leaves `system`/`tools` unchanged — byte-identical request body.
    const cached = applyPromptCaching(request.systemPrompt, request.tools, request.promptCaching);
    return JSON.stringify({
      model: aliasModel(request.model || defaultModel),
      max_tokens: request.maxTokens ?? 4096,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      system: cached.system,
      tools: cached.tools,
      messages: request.messages,
      ...(request.thinking ? { thinking: request.thinking } : {}),
      ...(stream && { stream: true }),
    });
  }

  async function fetchWithTimeout(
    body: string,
    _stream: boolean,
    signal?: AbortSignal,
    context?: LlmTransportContext,
  ): Promise<TransientFetchAttempt> {
    if (signal?.aborted) throw new Error('Agent run was cancelled');
    const lifetime = requestLifetime(timeoutMs, signal);

    try {
      // When an authenticated Salir proxy is configured (currently z.ai —
      // see resolveProviderRuntimeConfig), route through it instead of the
      // vendor host and let the server attach the credential headers. Every
      // other case stays byte-identical to the pre-proxy request.
      const proxy = config.proxy?.url ? config.proxy : undefined;
      const headers = proxy ? await anthropicWireProxyHeaders(proxy) : buildHeaders();
      const url = proxy ? proxy.url : `${baseUrl}/v1/messages`;
      const sendBody = proxy ? buildAnthropicWireProxyBody(baseUrl, config.apiKey, body) : body;
      // SECURITY, deliberate asymmetry — do NOT "fix" this for consistency.
      // The `fetchLlm` DESCRIPTOR carries the RAW Anthropic body; only the
      // `send` closure sees the proxy envelope. llm-transport.ts:76 states the
      // sibling invariant ("`send` alone closes over network
      // credentials/proxy envelopes"), and llm-journal.ts persists the
      // descriptor's `body` verbatim into the super-admin journal. Passing
      // `sendBody` here would therefore write the vendor API key — which
      // `buildProxyBody` puts inside the envelope — straight into that
      // journal.
      const response = await fetchLlm(
        { provider: meta.id, url, method: 'POST', headers, body, context },
        () => fetch(url, { method: 'POST', headers, body: sendBody, signal: lifetime.signal }),
        lifetime.signal,
      );
      return { response, dispose: lifetime.dispose };
    } catch (err) {
      lifetime.dispose();
      if (err instanceof LlmTransportError) throw err;
      if (signal?.aborted) throw new Error('Agent run was cancelled', { cause: err });
      throw err;
    }
  }

  function handleErrorResponse(res: Response, body: string): never {
    // Parsed once up front so the queue-level rate-limit retry policy can
    // honor it — the 401 throw below is a credential rejection, never a
    // rate limit, so it is deliberately left without one (#1124).
    const retryAfterMs = parseRetryAfterMs(res.headers?.get?.('retry-after') ?? null);

    // A response from an authenticated Salir proxy carries
    // `X-Salir-LLM-Upstream` once it actually reached the vendor. The
    // marker-absence rules that decide Salir-vs-vendor attribution live in
    // `anthropicWireProxyFailureMessage` so `./api.ts`'s legacy agent loop
    // applies exactly the same policy.
    if (config.proxy?.url) {
      const proxyMessage = anthropicWireProxyFailureMessage({
        status: res.status,
        body,
        hasUpstreamMarker: hasSalirLlmUpstreamMarker(res),
      });
      if (proxyMessage) {
        throw new LlmHttpError(res.status, proxyMessage, retryAfterMs != null ? { retryAfterMs } : undefined);
      }
    }

    if (res.status === 401) {
      throw new LlmHttpError(res.status, 'API key is invalid or expired. Check your API key in Settings.');
    }
    throw new LlmHttpError(
      res.status,
      `${meta.name} API error: ${res.status} ${body}`,
      retryAfterMs != null ? { retryAfterMs } : undefined,
    );
  }

  /**
   * Fleet-level overload recording (D7): feed 429/503/529 responses into the
   * shared `llmOverloadGuard` so a burst of overloads anywhere in the fleet
   * defers/clamps every LLM job, not just this call. `res.headers?.get?.(...)`
   * is defensively double-optional-chained because several existing test
   * doubles construct a bare `{ ok, status, text }` response with no
   * `headers` property at all.
   */
  function recordOverloadIfApplicable(res: Response): void {
    if (!isOverloadStatus(res.status)) return;
    llmOverloadGuard.recordOverload(res.status, parseRetryAfterMs(res.headers?.get?.('retry-after') ?? null));
  }

  /**
   * One request, retried through transient transport failures, with the
   * provider's error contract applied to whatever survives.
   *
   * `chat` and `chatStream` opened with the same four lines before this
   * existed, which is how the retry gap came to affect both at once.
   * `fetchWithTimeout` is passed as a thunk so each attempt builds a fresh
   * timeout rather than inheriting an expired one.
   */
  async function fetchOrThrow<T = never>(
    body: string,
    stream: boolean,
    signal?: AbortSignal,
    consume?: (res: Response) => Promise<T>,
    isPermanentError?: (err: unknown) => boolean,
    context?: LlmTransportContext,
  ) {
    const result = await fetchWithTransientRetry(() => fetchWithTimeout(body, stream, signal, context), {
      // Default the retry reporter to a log line: an unreported backoff is
      // invisible wall-clock, and a caller that supplies its own still wins.
      retry: {
        ...config.retry,
        onRetry:
          config.retry?.onRetry ??
          ((info) => log.warn({ ...info, provider: meta.id }, 'retrying transient LLM failure after backoff')),
      },
      ...(signal ? { signal } : {}),
      onAttempt: recordOverloadIfApplicable,
      ...(consume ? { consume } : {}),
      // A timeout is OUR OWN budget expiring, not a transport blip: the next attempt gets an
      // identical budget against the same slow model, so it fails identically while the person
      // waits three times as long and the Workspace pays three times over (salir-se/salir#1757
      // measured exactly that — three 30s attempts, 93s, one of them a completed 86s answer).
      // Caller cancellation never reaches here (`isCallerCancellation` short-circuits first).
      isPermanentError: (err) =>
        err instanceof LlmTransportError || isLlmTimeout(err) || Boolean(isPermanentError?.(err)),
    });
    const { res, bodyText } = result;
    if (!res.ok) handleErrorResponse(res, bodyText ?? '');
    return result;
  }

  return {
    id: meta.id,
    name: meta.name,

    async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
      const { value } = await fetchOrThrow(
        buildBody(request),
        false,
        request.signal,
        (res) => readWithCallerCancellation(res.json() as Promise<AnthropicMessagesJson>, request.signal),
        undefined,
        request.transportContext,
      );
      // `consume` is given, so a returned result always carries its value.
      const json = value as AnthropicMessagesJson;
      llmOverloadGuard.recordSuccess();
      return {
        content: json.content,
        usage: {
          inputTokens: json.usage.input_tokens,
          outputTokens: json.usage.output_tokens,
          // Issue #1085 (Phase 0): expand-only — omit rather than coerce to 0
          // when Anthropic didn't report cache stats for this response.
          ...(json.usage.cache_creation_input_tokens !== undefined
            ? { cacheCreationInputTokens: json.usage.cache_creation_input_tokens }
            : {}),
          ...(json.usage.cache_read_input_tokens !== undefined
            ? { cacheReadInputTokens: json.usage.cache_read_input_tokens }
            : {}),
        },
        stopReason: json.stop_reason,
        model: json.model,
        raw: json,
      };
    },

    async chatStream(request: LlmChatRequest, callbacks: LlmStreamCallbacks): Promise<LlmChatResponse> {
      // Issue #1824 (F1a follow-up): all of this per-response state is
      // declared once for the whole `chatStream` call, but `consume` below
      // re-runs on every retry attempt (`fetchWithTransientRetry` calls only
      // `doFetch`/`consume` again, never this outer function) — the
      // mid-stream-overload retry exception means a SECOND attempt can now
      // follow a first one that already pushed partial content. Every field
      // here is therefore reset at the TOP of `consume`, not just declared
      // here, so attempt 2 starts exactly as empty as attempt 1 did
      // (`api.ts`'s equivalent state already lives inside its per-attempt
      // loop and needed no such reset). `let`, not `const`, is required for
      // `contentBlocks`/`toolCalls` so the reset can rebind them — the
      // callbacks below close over the variable, not a snapshot of its
      // value, so a rebind is visible to them immediately.
      let contentBlocks: ContentBlock[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      // Issue #1085 (Phase 0): assigned (not accumulated) — Anthropic reports
      // the cache breakdown once on `message_start`, never incrementally.
      let cacheCreationInputTokens: number | undefined;
      let cacheReadInputTokens: number | undefined;
      let stopReason = 'end_turn';
      // Issue #1824 (F1b): the only signal a stream actually completed — EOF
      // without it means the turn was cut off, not finished.
      let sawMessageStop = false;
      // Keyed by the stream's own `content_block` index, never by "the last
      // block pushed" — two calls to the same tool in one turn must not share
      // an argument buffer. See streamed-tool-calls.ts.
      let toolCalls = new StreamedToolCalls();

      const streamCallbacks: StreamCallbacks = {
        onToken: (text) => {
          const last = contentBlocks[contentBlocks.length - 1];
          if (last && last.type === 'text') {
            last.text = (last.text || '') + text;
          } else {
            contentBlocks.push({ type: 'text', text });
          }
          callbacks.onToken?.(text);
        },
        onThinking: (text) => {
          const last = contentBlocks[contentBlocks.length - 1];
          if (last && last.type === 'thinking') {
            last.thinking = (last.thinking || '') + text;
          } else {
            contentBlocks.push({ type: 'thinking', thinking: text });
          }
          callbacks.onThinking?.(text);
        },
        onSignature: (sig) => {
          // A signature_delta always follows the thinking_delta(s) for the same
          // block, so the last block should be `thinking` here. Guarded rather
          // than assumed: a stray signature (should never happen) is a no-op
          // instead of corrupting an unrelated block.
          const last = contentBlocks[contentBlocks.length - 1];
          if (last && last.type === 'thinking') {
            last.signature = sig;
          }
        },
        onRedactedThinking: (data) => {
          contentBlocks.push({ type: 'redacted_thinking', data });
        },
        onToolCallStart: (name, id, blockIndex) => {
          const { block, isNew } = toolCalls.open(blockIndex ?? contentBlocks.length, id, name);
          if (isNew) contentBlocks.push(block);
          callbacks.onToolCallStart?.(name, id);
        },
        onToolCallDelta: (id, delta, blockIndex) => {
          // No index on the event → the call still being built (see append).
          toolCalls.append(blockIndex, delta);
          callbacks.onToolCallDelta?.(id, delta);
        },
        onUsage: (inp, out, cacheCreation, cacheRead) => {
          // Issue #1824 (F2): most Anthropic-compatible vendors send the real
          // `input_tokens` only on `message_start`, but some send `0` there
          // and the true total on `message_delta` instead — take the max
          // seen so far rather than accumulate, so a late correction can
          // raise the total but a `0` never lowers it.
          inputTokens = Math.max(inputTokens, inp);
          outputTokens += out;
          if (cacheCreation !== undefined) {
            cacheCreationInputTokens =
              cacheCreationInputTokens === undefined
                ? cacheCreation
                : Math.max(cacheCreationInputTokens, cacheCreation);
          }
          if (cacheRead !== undefined) {
            cacheReadInputTokens =
              cacheReadInputTokens === undefined ? cacheRead : Math.max(cacheReadInputTokens, cacheRead);
          }
          callbacks.onUsage?.(inp, out);
        },
        onStop: (reason) => {
          stopReason = reason;
          callbacks.onStop?.(reason);
        },
        onMessageStop: () => {
          sawMessageStop = true;
        },
      };

      let streamStarted = false;
      await fetchOrThrow(
        buildBody(request, true),
        true,
        request.signal,
        async (res) => {
          // Issue #1824 (F1a follow-up): reset every accumulator for THIS
          // attempt — see the comment on the declarations above. Without
          // this, a retried overload attempt would concatenate its content
          // onto whatever attempt 1 already pushed (duplicated text,
          // merged tool-call argument buffers, inflated outputTokens).
          contentBlocks = [];
          toolCalls = new StreamedToolCalls();
          inputTokens = 0;
          outputTokens = 0;
          cacheCreationInputTokens = undefined;
          cacheReadInputTokens = undefined;
          stopReason = 'end_turn';
          sawMessageStop = false;
          streamStarted = false;
          try {
            for await (const event of parseSSEStream(res, request.signal)) {
              streamStarted = true;
              processAnthropicEvent(event, streamCallbacks);
            }
            if (request.signal?.aborted) throw new Error('Agent run was cancelled');
            // Issue #1824 (F1b): EOF without `message_stop` is a truncated
            // response, not a completed turn — see the matching comment in
            // `../api.ts`'s `callWithRetryStreaming`.
            if (!sawMessageStop) {
              throw new Error('LLM stream ended before message_stop (truncated response)');
            }
          } catch (err) {
            if (request.signal?.aborted) throw new Error('Agent run was cancelled', { cause: err });
            throw err;
          }
        },
        // Issue #1824 (F1a): a stream that already started is not retried —
        // UNLESS the failure is the explicit transient `error` event
        // (`overloaded_error`/`rate_limit_error`), which is retried exactly
        // like its non-streaming 429/529 counterpart. Every other post-start
        // failure (a dropped connection, the F1b truncation error above)
        // keeps the existing "never blindly retry" rule. The final RETURNED
        // response is always attempt-2-only (see the per-attempt reset
        // above) — but when the caller requested live token streaming, the
        // failed attempt's `onToken`/`onThinking`/`onToolCallStart` deltas
        // were already forwarded to the caller before the retry happened, so
        // a live UI MAY briefly render the partial text twice (once from the
        // aborted attempt, once from the retry). Not fixed here — it is a
        // transient rendering artifact, not a data-correctness issue.
        (err) => streamStarted && !(err instanceof AnthropicStreamError && isOverloadStatus(err.status)),
        request.transportContext,
      );
      llmOverloadGuard.recordSuccess();

      // Parse accumulated tool input JSON
      toolCalls.finalize((block) => log.warn({ tool: block.name }, 'Failed to parse streamed tool input JSON'));

      return {
        content: contentBlocks,
        usage: {
          inputTokens,
          outputTokens,
          // Issue #1085 (Phase 0): expand-only — omit rather than coerce to 0.
          ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
          ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
        },
        stopReason,
      };
    },

    async testConnection(model?: string): Promise<LlmTestResult> {
      // Intentionally never touches llmOverloadGuard (no recordOverload/recordSuccess): this is
      // operator-driven probe traffic from the Settings panel's "Test connection" button, not real
      // agent traffic — letting it mutate fleet state would let a settings page click extend or
      // shorten a live cooldown for every other workspace agent (D7).
      const start = performance.now();
      try {
        // Compare against the id actually put on the wire, not the raw
        // argument: a retired-alias rewrite is our substitution, not the
        // provider's, and must not read as a provider mismatch.
        const requestedModel = aliasModel(model || defaultModel);
        const attempt = await fetchWithTimeout(
          JSON.stringify({
            model: requestedModel,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          false,
          undefined,
          { agent: 'probe' },
        );
        try {
          const res = attempt.response;
          const latencyMs = Math.round(performance.now() - start);

          if (res.ok) {
            const data = (await res.json()) as { model?: unknown };
            // A 200 does not mean the provider honoured the requested id — it may
            // have resolved it to a different model entirely. Surface both sides
            // so a substitution can't hide behind a green "Connected".
            const comparison = compareServedModel(
              requestedModel,
              typeof data.model === 'string' ? data.model : undefined,
            );
            return {
              ok: true,
              message: `Connected (${latencyMs}ms${comparison.mismatch ? describeServedModel(comparison) : ''})`,
              latencyMs,
              model: comparison.served,
              requestedModel: comparison.requested,
              modelMismatch: comparison.mismatch,
            };
          }

          const body = await res.text().catch(() => '');
          const detail = formatProviderErrorDetail(res, body);
          if (res.status === 401) {
            return { ok: false, message: `Invalid API key (401 Unauthorized)${detail}`, latencyMs };
          }
          return { ok: false, message: `API error ${res.status}${detail || `: ${body}`}`, latencyMs };
        } finally {
          attempt.dispose();
        }
      } catch (err) {
        const latencyMs = Math.round(performance.now() - start);
        return { ok: false, message: `Connection failed: ${(err as Error).message}`, latencyMs };
      }
    },
  };
}

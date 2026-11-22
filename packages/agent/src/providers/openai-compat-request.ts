import type { ReasoningEffort } from '@prompt-studio/types';
import { resolveDynamicHeaders } from '../anthropic-wire-proxy';
import type { LlmChatRequest, LlmProviderConfig } from '../provider';
import { reasonsByDefault, requiresResponsesApiForTools } from '../thinking-config';
import type { NativeToolDropContext } from './native-tool-drop';
import {
  aliasModel,
  DEFAULT_MODEL,
  isDirectOpenAI,
  isGoogleAiStudio,
  log,
  openaiCompatOrigin,
  RESPONSES_PATH,
  toOpenAIMessages,
  toOpenAITools,
  withOutputTokenLimit,
} from './openai-compat-format';
import { buildResponsesBody } from './openai-responses';

export function createOpenAIRequests(config: LlmProviderConfig, providerMeta: { id: string; name: string }) {
  const baseUrl = openaiCompatOrigin(config.baseUrl || 'https://api.openai.com');
  const defaultModel = config.model || DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs || 120_000;
  const usesChatGptSubscription = config.authMode === 'chatgpt-subscription';
  const useProxy = usesChatGptSubscription
    ? Boolean(config.proxy?.url)
    : isDirectOpenAI(baseUrl) && Boolean(config.proxy?.url);

  if (usesChatGptSubscription && !useProxy) {
    throw new Error('ChatGPT subscription authentication requires an authenticated Salir runtime proxy.');
  }

  /**
   * Headers for one request.
   *
   * `config.authHeaders` (ADR-280, Hosted LLM) REPLACES the vendor bearer
   * rather than adding to it: the Hosted provider's stored key is a Facade API
   * key that authorizes nothing, and `services/ai` authenticates the caller's
   * own Access token plus `X-Salir-Workspace-Id`. Sending the facade alongside
   * it would leak a credential-shaped value for no benefit and 401 the call if
   * it won precedence. Resolved per request so a rotated Access token is sent.
   */
  async function buildHeaders(): Promise<Record<string, string>> {
    const sessionHeaders = config.authHeaders ? await resolveDynamicHeaders(config.authHeaders) : undefined;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(sessionHeaders ? sessionHeaders : { Authorization: `Bearer ${config.apiKey}` }),
    };

    // OpenRouter-specific metadata headers
    if (config.appUrl) headers['HTTP-Referer'] = config.appUrl;
    if (config.appName) headers['X-Title'] = config.appName;

    return headers;
  }

  /** The model this request will actually be sent with, alias rewrites applied. */
  function resolveModel(request: LlmChatRequest): string {
    return aliasModel(request.model || defaultModel);
  }

  /**
   * True when this request has to go to `/v1/responses` instead of
   * `/v1/chat/completions`.
   *
   * The GPT-5.6 family refuses function tools combined with reasoning on Chat
   * Completions, and reasons by default — so a plain tool-carrying request
   * with no `reasoning_effort` at all is rejected too. Responses is the
   * endpoint where tools and reasoning coexist, so tool-carrying requests for
   * those models go there and keep the reasoning the customer is paying for.
   *
   * Scoped to direct OpenAI: OpenRouter exposes its own unified surface and
   * normalizes reasoning per upstream, so picking endpoints on its behalf
   * would be this module overreaching.
   */
  function usesResponsesApi(request: LlmChatRequest): boolean {
    if (usesChatGptSubscription) return true;
    if (!isDirectOpenAI(baseUrl)) return false;
    if (request.tools.length === 0) return false;
    return requiresResponsesApiForTools(resolveModel(request), request.reasoningEffort);
  }

  /**
   * The effort to put on a `/v1/chat/completions` request.
   *
   * Reaching here with tools and a reasons-by-default model means the Responses
   * path was unavailable (a non-OpenAI base URL, or the fallback below). On
   * this endpoint that combination is only legal with reasoning explicitly
   * off, so clamp to `'none'` — a degraded answer beats a 400 that fails the
   * whole run, and it is the alternative OpenAI's own error message names.
   */
  function chatCompletionsEffort(request: LlmChatRequest): ReasoningEffort | undefined {
    if (request.tools.length > 0 && isDirectOpenAI(baseUrl) && reasonsByDefault(resolveModel(request))) {
      return 'none';
    }
    return request.reasoningEffort;
  }

  /** Where this adapter records a tool it cannot put on the wire: one warn line per request, with the provider. */
  const nativeToolDrop: NativeToolDropContext = { provider: providerMeta.id, log };

  function buildResponsesRequestBody(request: LlmChatRequest, stream = false): string {
    const body = buildResponsesBody({
      model: resolveModel(request),
      systemPrompt: request.systemPrompt,
      messages: request.messages,
      tools: request.tools,
      nativeToolDrop,
      maxTokens: request.maxTokens ?? 4096,
      reasoningEffort: request.reasoningEffort,
      stream: usesChatGptSubscription || stream,
      store: usesChatGptSubscription ? false : undefined,
    });
    // Codex subscription requests omit output limits, matching OpenCode's chat.params hook.
    if (usesChatGptSubscription) delete body.max_output_tokens;
    return JSON.stringify(body);
  }

  function buildBody(request: LlmChatRequest, stream = false): string {
    // Intentionally does not forward `request.thinking`: that's an Anthropic
    // Messages API request shape, and `resolveThinkingConfig` never enables
    // thinking for a non-Anthropic-wire provider (see thinking-config.ts).
    // `request.reasoningEffort` IS the OpenAI-wire analog and is forwarded
    // below — `resolveReasoningConfig` (thinking-config.ts) decides whether
    // it's set, and `chatCompletionsEffort` clamps it where this endpoint
    // refuses to combine it with function tools.
    const body: Record<string, unknown> = withOutputTokenLimit(
      {
        model: resolveModel(request),
        messages: toOpenAIMessages(request.systemPrompt, request.messages),
      },
      request.maxTokens ?? 4096,
      baseUrl,
    );

    if (request.tools.length > 0) {
      body.tools = toOpenAITools(request.tools, nativeToolDrop);
    }

    const effort = chatCompletionsEffort(request);
    if (effort) {
      if (providerMeta.id === 'openrouter') {
        body.reasoning = { effort };
      } else {
        body.reasoning_effort = effort;
      }
    }

    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    return JSON.stringify(body);
  }

  /**
   * Wrap a request for the browser-safe LLM proxy.
   *
   * `endpoint` is expand-only and sent ONLY for the Responses path: a proxy
   * deployed before this change rejects unknown envelope keys, and omitting it
   * for every request that does not need it keeps those deployments working
   * exactly as before. A new client against an old proxy therefore degrades
   * only for the models that were already failing, and its 400 lands on the
   * Chat Completions fallback below rather than on the user.
   */
  function buildProxyBody(body: string, path: string): string {
    if (usesChatGptSubscription) {
      return JSON.stringify({
        authMode: 'chatgpt-subscription',
        request: JSON.parse(body) as unknown,
      });
    }
    return JSON.stringify({
      baseUrl,
      apiKey: config.apiKey,
      request: JSON.parse(body) as unknown,
      ...(path === RESPONSES_PATH ? { endpoint: 'responses' } : {}),
    });
  }

  function directOpenAiBrowserError(): Error {
    return new Error(
      'OpenAI cannot be called directly from the browser because api.openai.com blocks CORS. ' +
        'Reload the app so the authenticated LLM proxy is available, or choose Anthropic, OpenRouter, or z.ai.',
    );
  }

  /**
   * The provider name to show a PERSON in a thrown error message — never
   * `providerMeta.id` (the telemetry/auth-mode key, unchanged everywhere),
   * and not always `providerMeta.name` (the Settings card label, still used
   * unmodified for the returned `LlmProvider.name` and everywhere else).
   *
   * Derived from the resolved host: the Settings "OpenAI" card is the
   * OpenAI-compat adapter, not api.openai.com, and our own setup guide tells
   * operators to point it at Google AI Studio's OpenAI-compat endpoint. A
   * real user did exactly that, hit a Gemini-specific 400 (#1629), and was
   * told "OpenAI API error: 400" — nothing said the call had gone to Google, so
   * they spent an hour investigating OpenAI/AI Studio billing instead of the
   * actual (protocol) cause. Every other host keeps `providerMeta.name`
   * unchanged — this fixes the one demonstrated confusion, not a general
   * "guess the real vendor" feature.
   */
  function errorProviderName(): string {
    return isGoogleAiStudio(baseUrl) ? 'Google AI Studio' : providerMeta.name;
  }

  return {
    config,
    providerMeta,
    baseUrl,
    defaultModel,
    timeoutMs,
    usesChatGptSubscription,
    useProxy,
    buildHeaders,
    resolveModel,
    usesResponsesApi,
    buildResponsesRequestBody,
    buildBody,
    buildProxyBody,
    directOpenAiBrowserError,
    errorProviderName,
  };
}
export type OpenAIRequests = ReturnType<typeof createOpenAIRequests>;

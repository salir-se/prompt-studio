/**
 * OpenAI-compatible Chat Completions provider.
 *
 * Wire format: POST /v1/chat/completions (OpenAI standard)
 * Auth: Authorization: Bearer <key>
 * Body: { model, messages (with system as first message), tools, max_tokens/max_completion_tokens, stream }
 * Response: { choices: [{ message: { content, tool_calls } }], usage }
 *
 * This covers the vast majority of LLM providers:
 * - OpenRouter (openrouter.ai)
 * - z.ai
 * - OpenAI (api.openai.com)
 * - Groq (api.groq.com)
 * - Together (api.together.xyz)
 * - Fireworks (api.fireworks.ai)
 * - Local: vLLM, Ollama, LM Studio, etc.
 *
 * Converts between OpenAI Chat Completions format and our internal
 * ContentBlock-based format (which matches Anthropic's structure).
 */

import { compareServedModel, describeServedModel } from '../vendor/served-model';
import { LlmTransportError } from '../llm-transport';
import { llmOverloadGuard } from '../overload-guard';
import type { LlmChatRequest, LlmChatResponse, LlmProvider, LlmProviderConfig, LlmTestResult } from '../provider';
import { formatProviderErrorDetail } from '../provider-error-detail';
import { readWithCallerCancellation } from '../request-lifetime';
import {
  aliasModel,
  CHAT_COMPLETIONS_PATH,
  fromOpenAIResponse,
  isDirectOpenAI,
  isGoogleAiStudio,
  isOpenAiQuotaError,
  isResponsesEndpointUnusable,
  OPENAI_QUOTA_ERROR_MESSAGE,
  openaiCompatRequestUrl,
  RESPONSES_PATH,
  withOutputTokenLimit,
} from './openai-compat-format';
import { createOpenAIRequests } from './openai-compat-request';
import { createOpenAIStreams } from './openai-compat-stream';
import { createOpenAITransport } from './openai-compat-transport';
import { fromResponsesResponse } from './openai-responses';

export function createOpenAICompatProvider(
  config: LlmProviderConfig,
  providerMeta: { id: string; name: string } = { id: 'openai-compat', name: 'OpenAI Compatible' },
): LlmProvider {
  const requests = createOpenAIRequests(config, providerMeta);
  const { baseUrl, defaultModel, usesChatGptSubscription, usesResponsesApi, buildResponsesRequestBody, buildBody } =
    requests;
  const transport = createOpenAITransport(requests);
  const { fetchOrThrow, fetchWithTimeout } = transport;
  const { fetchResponsesStream, logResponsesFallback, chatStream } = createOpenAIStreams(requests, transport);
  return {
    id: providerMeta.id,
    name: providerMeta.name,

    async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
      if (usesResponsesApi(request)) {
        try {
          if (usesChatGptSubscription) {
            const response = await fetchResponsesStream(request, {});
            llmOverloadGuard.recordSuccess();
            return response;
          }
          const { value } = await fetchOrThrow(
            buildResponsesRequestBody(request),
            request.signal,
            RESPONSES_PATH,
            (res) => readWithCallerCancellation(res.json() as Promise<Record<string, unknown>>, request.signal),
            undefined,
            request.transportContext,
          );
          llmOverloadGuard.recordSuccess();
          // `consume` is given, so a returned result always carries its value.
          return fromResponsesResponse(value as Record<string, unknown>);
        } catch (err) {
          if (err instanceof LlmTransportError || usesChatGptSubscription || !isResponsesEndpointUnusable(err))
            throw err;
          logResponsesFallback(request, err);
          // Falls through: `buildBody` clamps reasoning off for this model, so
          // the retry is a legal Chat Completions request rather than the same
          // rejection again.
        }
      }
      const { value } = await fetchOrThrow(
        buildBody(request),
        request.signal,
        CHAT_COMPLETIONS_PATH,
        (res) => readWithCallerCancellation(res.json() as Promise<Record<string, unknown>>, request.signal),
        undefined,
        request.transportContext,
      );
      llmOverloadGuard.recordSuccess();
      // `consume` is given, so a returned result always carries its value.
      return fromOpenAIResponse(value as Record<string, unknown>);
    },

    chatStream,

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
        if (usesChatGptSubscription) {
          const response = await fetchResponsesStream(
            {
              model: requestedModel,
              systemPrompt: 'Reply with only OK.',
              transportContext: { agent: 'probe' },
              messages: [{ role: 'user', content: 'hi' }],
              tools: [],
            },
            {},
          );
          if (
            !response.raw ||
            typeof response.raw !== 'object' ||
            !('status' in response.raw) ||
            response.raw.status !== 'completed' ||
            !response.content.some((block) => block.type === 'text' && block.text?.trim())
          ) {
            throw new Error('ChatGPT did not complete a text response. Try Test connection again.');
          }
          const latencyMs = Math.round(performance.now() - start);
          const comparison = compareServedModel(requestedModel, response.model);
          return {
            ok: true,
            message: `Connected (${latencyMs}ms${comparison.mismatch ? describeServedModel(comparison) : ''})`,
            latencyMs,
            model: comparison.served,
            requestedModel: comparison.requested,
            modelMismatch: comparison.mismatch,
          };
        }
        const probeBody = withOutputTokenLimit(
          {
            model: requestedModel,
            messages: [{ role: 'user', content: 'hi' }],
            // Gemini 3.7 Flash thinks at medium by default; a 10-token probe
            // then sits on thinking until it hits the cap. Low effort keeps
            // Test connection a liveness check.
            ...(isGoogleAiStudio(baseUrl) ? { reasoning_effort: 'low' } : {}),
          },
          10,
          baseUrl,
        );
        const attempt = await fetchWithTimeout(
          openaiCompatRequestUrl(baseUrl, CHAT_COMPLETIONS_PATH),
          JSON.stringify(probeBody),
          undefined,
          CHAT_COMPLETIONS_PATH,
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
          if (isDirectOpenAI(baseUrl) && isOpenAiQuotaError(res, body)) {
            return { ok: false, message: `${OPENAI_QUOTA_ERROR_MESSAGE}${detail}`, latencyMs };
          }
          return { ok: false, message: `API error ${res.status}${detail || (body ? `: ${body}` : '')}`, latencyMs };
        } finally {
          attempt.dispose();
        }
      } catch (err) {
        const latencyMs = Math.round(performance.now() - start);
        const failure = err as { message?: unknown; code?: unknown; correlationId?: unknown };
        return {
          ok: false,
          message: `Connection failed: ${typeof failure.message === 'string' ? failure.message : String(err)}`,
          latencyMs,
          ...(typeof failure.code === 'string' ? { code: failure.code } : {}),
          ...(typeof failure.correlationId === 'string' ? { correlationId: failure.correlationId } : {}),
        };
      }
    },
  };
}

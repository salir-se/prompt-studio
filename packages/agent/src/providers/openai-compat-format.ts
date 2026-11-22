import { createLogger } from '@prompt-studio/observability';
import type { ToolDefinition } from '@prompt-studio/prompts';
import { llmHttpStatus } from '../llm-http-error';
import { withOpenAiCacheUsage } from '../openai-cached-tokens';
import type { LlmChatResponse } from '../provider';
import type { ContentBlock } from '../types';
import { type NativeToolDropContext, partitionNativeTools } from './native-tool-drop';

export const log = createLogger('llm:openai-compat');

export const DEFAULT_MODEL = 'claude-sonnet-5';

export const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';
export const RESPONSES_PATH = '/v1/responses';

/**
 * Statuses that mean "this endpoint would not take this request" and so make
 * the Chat Completions fallback worth one attempt: a rejected request shape
 * (400) or an endpoint the host does not serve (404, e.g. a gateway or proxy
 * that only implements Chat Completions).
 *
 * Deliberately NOT 401/402/429/5xx — those say something about the credential,
 * the account, or the upstream's health, none of which a second request on a
 * different path can fix, so retrying would only burn quota and delay the real
 * message.
 */
export function isResponsesEndpointUnusable(err: unknown): boolean {
  const status = llmHttpStatus(err);
  return status === 400 || status === 404;
}

// Cover the same retired-alias rewrite as the native Anthropic provider
// (`./anthropic.ts`) — z.ai's `/api/anthropic` endpoint and OpenRouter's
// `anthropic/*` model routing both proxy to Anthropic and inherit the
// same 404-on-retired-model behaviour. The leading `anthropic/` prefix
// is preserved when the input carries it (OpenRouter routing form).
export const RETIRED_MODEL_ALIASES: Readonly<Record<string, string>> = {
  'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
  'anthropic/claude-sonnet-4-20250514': 'anthropic/claude-sonnet-4-6',
};

export function aliasModel(model: string): string {
  return RETIRED_MODEL_ALIASES[model] ?? model;
}

export const GOOGLE_AI_STUDIO_HOST = 'generativelanguage.googleapis.com';
export const GOOGLE_OPENAI_COMPAT_PREFIX = '/v1beta/openai';

/**
 * Direct OpenAI is the api.openai.com host, not the Settings "OpenAI" card.
 * That card is the OpenAI-compat adapter: operators point it at Ollama Cloud
 * (or any other /v1/chat/completions host). Card-id checks sent those calls
 * through the OpenAI CORS proxy, used max_completion_tokens, and blocked the
 * browser.
 */
export function isDirectOpenAI(baseUrl: string): boolean {
  return baseUrl.includes('api.openai.com');
}

export function hostnameOf(baseUrl: string): string {
  try {
    return new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).hostname;
  } catch {
    return '';
  }
}

export function isGoogleAiStudio(baseUrl: string): boolean {
  return hostnameOf(baseUrl) === GOOGLE_AI_STUDIO_HOST;
}

/**
 * Origin only. Most hosts get `/v1/chat/completions` appended.
 * Google AI Studio's OpenAI-compat surface is `/v1beta/openai/chat/completions`.
 */
export function openaiCompatOrigin(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (isGoogleAiStudio(trimmed)) {
    return trimmed.replace(/\/v1beta\/openai(?:\/v1)?$/i, '').replace(/\/v1$/i, '');
  }
  return trimmed.replace(/\/v1$/i, '');
}

export function openaiCompatRequestUrl(origin: string, path: string): string {
  if (isGoogleAiStudio(origin)) {
    const leaf = path.replace(/^\/v1(?=\/|$)/, '');
    return `${origin}${GOOGLE_OPENAI_COMPAT_PREFIX}${leaf}`;
  }
  return `${origin}${path}`;
}

export function withOutputTokenLimit(
  body: Record<string, unknown>,
  tokenLimit: number,
  baseUrl: string,
): Record<string, unknown> {
  return {
    ...body,
    [isDirectOpenAI(baseUrl) ? 'max_completion_tokens' : 'max_tokens']: tokenLimit,
  };
}

export type ProviderErrorPayload = {
  message?: string;
  type?: string;
  code?: string;
};

export const OPENAI_QUOTA_ERROR_MESSAGE =
  'OpenAI API budget or quota is exhausted. Add credits or increase the OpenAI project budget, then retry the agent run. ' +
  'You can also switch this workspace to another LLM provider with available quota.';

export function parseProviderErrorPayload(body: string): ProviderErrorPayload {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown; type?: unknown; code?: unknown } };
    const error = parsed.error ?? {};
    return {
      message: typeof error.message === 'string' ? error.message : undefined,
      type: typeof error.type === 'string' ? error.type : undefined,
      code: typeof error.code === 'string' ? error.code : undefined,
    };
  } catch {
    return { message: body };
  }
}

export function isOpenAiQuotaError(res: Response, body: string): boolean {
  const error = parseProviderErrorPayload(body);
  const fields = [error.code, error.type, error.message].filter(Boolean).join(' ').toLowerCase();
  if (res.status === 402) return true;
  if (fields.includes('insufficient_quota')) return true;
  if (fields.includes('billing_hard_limit') || fields.includes('billing_not_active')) return true;
  if (fields.includes('exceeded your current quota') || fields.includes('check your plan and billing')) return true;
  return fields.includes('quota exceeded') || fields.includes('hard limit');
}

// ── Format conversion: Anthropic ↔ OpenAI ────────────────────────────────

/**
 * Convert Anthropic-style tool definitions to OpenAI function-calling format. A native-only tool (`web_search`) has no
 * function shape and is dropped — said so through `drop`, never silently (`./native-tool-drop.ts`).
 */
export function toOpenAITools(tools: ToolDefinition[], drop?: NativeToolDropContext): unknown[] {
  return partitionNativeTools(tools, drop).functionTools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

/** Convert Anthropic-style messages to OpenAI format (system as first message). */
export function toOpenAIMessages(systemPrompt: string, messages: unknown[]): unknown[] {
  const result: unknown[] = [{ role: 'system', content: systemPrompt }];

  for (const msg of messages as Array<{ role: string; content: unknown }>) {
    if (msg.role === 'user') {
      if (Array.isArray(msg.content) && msg.content.some((block) => isAnthropicToolResult(block))) {
        const nonToolContent = msg.content.filter((block) => !isAnthropicToolResult(block));
        if (nonToolContent.length > 0) {
          result.push({ role: 'user', content: stringifyContent(nonToolContent) });
        }
        for (const block of msg.content.filter(isAnthropicToolResult)) {
          result.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: stringifyContent(block.content),
          });
        }
        continue;
      }
      // User messages pass through
      result.push({ role: 'user', content: stringifyContent(msg.content) });
    } else if (msg.role === 'assistant') {
      // Convert Anthropic content blocks to OpenAI format
      const openaiMsg: Record<string, unknown> = { role: 'assistant' };

      if (Array.isArray(msg.content)) {
        const blocks = msg.content as ContentBlock[];
        const textParts = blocks.filter((b) => b.type === 'text').map((b) => b.text);
        const toolCalls = blocks
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({
            id: b.id,
            type: 'function',
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input),
            },
            // Expand-only: replay Google's `thought_signature` (carried on
            // `providerExtra`, see types.ts) at the identical wire path it
            // arrived at, or omit the key entirely. Google 400s a replayed
            // function call missing this; every other OpenAI-compatible host
            // never sees the key, so its request body is byte-identical.
            ...(b.providerExtra ? { extra_content: b.providerExtra } : {}),
          }));

        if (textParts.length > 0) openaiMsg.content = textParts.join('');
        if (toolCalls.length > 0) openaiMsg.tool_calls = toolCalls;
        if (!openaiMsg.content && toolCalls.length === 0) openaiMsg.content = '';
      } else {
        openaiMsg.content = stringifyContent(msg.content);
      }

      result.push(openaiMsg);
    } else if (msg.role === 'tool') {
      // Anthropic tool_result → OpenAI tool message
      const toolMsg = msg as { role: string; tool_use_id?: string; content: unknown };
      result.push({
        role: 'tool',
        tool_call_id: toolMsg.tool_use_id ?? '',
        content: stringifyContent(toolMsg.content),
      });
    }
  }

  return result;
}

export function isAnthropicToolResult(
  value: unknown,
): value is { type: 'tool_result'; tool_use_id: string; content: unknown } {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'tool_result';
}

export function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object' && 'text' in c) return (c as { text: string }).text;
        return JSON.stringify(c);
      })
      .join('');
  }
  return JSON.stringify(content);
}

/**
 * Map a Chat Completions `finish_reason` onto the `stop_reason` vocabulary the
 * runner branches on (Anthropic-style): `'tool_use'` keeps the loop going,
 * `'max_tokens'` triggers the truncation path (mirrors `'length'`, OpenAI's
 * name for the same condition — see `toStopReason` in openai-responses.ts),
 * and `'end_turn'` ends the run. Shared by the non-streaming and streaming
 * paths below so the two can't drift.
 */
export function mapFinishReason(finishReason: string): string {
  if (finishReason === 'tool_calls') return 'tool_use';
  if (finishReason === 'stop') return 'end_turn';
  if (finishReason === 'length') return 'max_tokens';
  return finishReason;
}

/** Convert OpenAI response to our internal ContentBlock format. */
export function fromOpenAIResponse(data: Record<string, unknown>): LlmChatResponse {
  const choices = (data.choices as Array<Record<string, unknown>>) || [];
  const choice = choices[0] || {};
  const message = (choice.message as unknown as Record<string, unknown>) || {};
  const usage = (data.usage as Record<string, unknown>) || {};

  const content: ContentBlock[] = [];

  // Text content
  if (message.content && typeof message.content === 'string') {
    content.push({ type: 'text', text: message.content });
  }

  // Tool calls
  const toolCalls = (message.tool_calls as Array<Record<string, unknown>>) || [];
  for (const tc of toolCalls) {
    const fn = tc.function as unknown as Record<string, unknown>;
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse((fn.arguments as string) || '{}');
    } catch {
      log.warn('Failed to parse tool call arguments');
    }
    // Google's OpenAI-compat surface puts a `thought_signature` here that it
    // requires echoed back verbatim on replay (see `ContentBlock.providerExtra`).
    // Carried as an opaque bag — absent (never `{}`) when the provider didn't send one.
    const extraContent = tc.extra_content as Record<string, unknown> | undefined;
    content.push({
      type: 'tool_use',
      id: tc.id as string,
      name: fn.name as string,
      input,
      ...(extraContent ? { providerExtra: extraContent } : {}),
    });
  }

  // Map stop reason
  const finishReason = (choice.finish_reason as string) || 'stop';
  const stopReason = mapFinishReason(finishReason);

  return {
    content,
    usage: withOpenAiCacheUsage(
      {
        inputTokens: (usage.prompt_tokens as number) || 0,
        outputTokens: (usage.completion_tokens as number) || 0,
      },
      usage,
    ),
    stopReason,
    model: data.model as string | undefined,
    raw: data,
  };
}

/**
 * LLM Provider abstraction — pluggable interface for different LLM backends.
 *
 * Today: Anthropic (direct), OpenRouter, z.ai
 * Tomorrow: OpenAI, Google Gemini, Mistral, local models, etc.
 *
 * The provider handles:
 * - Auth headers (API key format, bearer vs x-api-key)
 * - Endpoint URL construction
 * - Request body format (Anthropic Messages API shape)
 * - Response parsing
 * - Provider-specific metadata headers
 *
 * The agent runner calls provider.chat() instead of building raw HTTP requests.
 */

import type { ToolDefinition } from '@prompt-studio/prompts';
import type { OpenAiAuthMode, ReasoningEffort } from '@prompt-studio/types';
import type { AnthropicWireProxy, AnthropicWireProxyHeaders } from './anthropic-wire-proxy';
import type { LlmTransportContext } from './llm-transport';
import type { ThinkingParam } from './thinking-config';
import type { TransientRetryConfig } from './transient-retry';
import type { ApiResponse, ContentBlock } from './types';

// ── Provider interface ───────────────────────────────────────────────────

export interface LlmChatRequest {
  /** Per-call identity for opt-in raw capture; custom provider implementations must opt in themselves. */
  transportContext?: LlmTransportContext;
  model: string;
  systemPrompt: string;
  messages: unknown[];
  tools: ToolDefinition[];
  maxTokens?: number;
  /**
   * Sampling temperature for deterministic classification calls (Critic
   * Inbound). Consumed only by the Anthropic-wire adapter; OpenAI-compatible
   * adapters deliberately ignore it (reasoning models reject it). Omit to send
   * nothing.
   */
  temperature?: number;
  /** Provider-specific thinking fragment (adaptive for Claude 4.6+, `{type:'enabled'}` for z.ai); omit for no-thinking. */
  thinking?: ThinkingParam;
  /** OpenAI-wire reasoning effort; adapters emit `reasoning_effort` (OpenAI) or `reasoning: { effort }` (OpenRouter). Omit to send nothing. */
  reasoningEffort?: ReasoningEffort;
  /**
   * Issue #1085 (Phase 1): request Anthropic prompt caching — a `cache_control:
   * {type:'ephemeral'}` breakpoint on the last system-prompt block (and the last
   * tools-array entry, when present). Only consumed by Anthropic-wire adapters
   * (`providers/anthropic.ts`); OpenAI-compatible adapters ignore it. Omit/false =
   * byte-identical request body to today.
   */
  promptCaching?: boolean;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface LlmChatResponse {
  content: ContentBlock[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    /**
     * Issue #1085 (Phase 0): Anthropic prompt-cache write tokens for this
     * response, when the provider reports them. Expand-only — absent (never
     * coerced to `0`) on providers/requests that don't use caching.
     */
    cacheCreationInputTokens?: number;
    /** Issue #1085 (Phase 0): Anthropic prompt-cache read tokens. See {@link cacheCreationInputTokens}. */
    cacheReadInputTokens?: number;
  };
  stopReason: string;
  model?: string;
  /** Raw response for provider-specific inspection. */
  raw?: unknown;
}

export interface LlmStreamCallbacks {
  onToken?(text: string): void;
  onThinking?(text: string): void;
  onToolCallStart?(name: string, id: string): void;
  onToolCallDelta?(id: string, delta: string): void;
  onUsage?(inputTokens: number, outputTokens: number): void;
  onStop?(reason: string): void;
}

export interface LlmTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  /** Stable BFF error code when the probe reached a Salir proxy. */
  code?: string;
  /** BFF request join key, suitable for a copyable support reference. */
  correlationId?: string;
  /** Model the provider actually served, as it echoed it back. */
  model?: string;
  /**
   * Model the test asked for. Kept alongside `model` because providers may
   * resolve a request to a different id (z.ai answers `glm-5.2` with
   * `glm-5.3`), and a caller can only explain that to the operator if it can
   * see both sides.
   */
  requestedModel?: string;
  /**
   * True when `model` and `requestedModel` name genuinely different models —
   * a connected-but-not-what-you-configured result. Dated builds and vendor
   * routing prefixes of the same model do NOT set this. Undefined only from
   * callers that predate the comparison.
   */
  modelMismatch?: boolean;
}

/** Abstract LLM provider. Implement this to add a new backend. */
export interface LlmProvider {
  /** Provider identifier (e.g., 'anthropic', 'openrouter', 'zai'). */
  readonly id: string;

  /** Human-readable name. */
  readonly name: string;

  /** Send a chat completion request (non-streaming). */
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;

  /** Send a streaming chat completion request. */
  chatStream(request: LlmChatRequest, callbacks: LlmStreamCallbacks): Promise<LlmChatResponse>;

  /** Test the connection (lightweight ping). */
  testConnection(model?: string): Promise<LlmTestResult>;
}

export interface LlmProviderConfig {
  /** Empty only for ChatGPT subscription mode, whose credential stays in the BFF. */
  apiKey: string;
  /** OpenAI only. Omitted means the existing API-key transport. */
  authMode?: OpenAiAuthMode;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  proxy?: AnthropicWireProxy;
  /**
   * Session headers attached to a DIRECT request instead of the provider's own
   * API key (ADR-280, Hosted LLM). Resolved on every fetch, so a rotated Access
   * token is sent. When present the adapter must NOT send
   * `Authorization: Bearer <apiKey>` — Hosted's stored key is a Facade API key
   * that authorizes nothing and `services/ai` rejects it by design.
   *
   * Distinct from `proxy`: that wraps the request in the BFF envelope
   * (`{ baseUrl, apiKey, request }`) for a vendor the browser cannot call
   * directly; this one calls a Salir worker that speaks the vendor wire format
   * itself, so the body stays verbatim.
   */
  authHeaders?: AnthropicWireProxyHeaders;
  /**
   * The `fetch` a request is sent with. Omitted means the global `fetch`. A
   * Worker passes a service binding's `fetch` here (ADR-284: the Salir bot
   * reaches the Hosted LLM Worker through its binding, never a public host).
   * Only the OpenAI-compatible adapter reads it today.
   */
  fetch?: typeof fetch;
  /** App metadata for referrer headers (OpenRouter). */
  appUrl?: string;
  appName?: string;
  /**
   * Transient-failure retry. Omitted means the safe default (3 attempts,
   * 1s doubling) — never "no retry", because a provider silently without
   * retries is the defect this field exists to close.
   */
  retry?: TransientRetryConfig;
}

// ── Provider registry ────────────────────────────────────────────────────

const providers = new Map<string, (config: LlmProviderConfig) => LlmProvider>();

/** Register a provider factory. */
export function registerProvider(id: string, factory: (config: LlmProviderConfig) => LlmProvider): void {
  providers.set(id, factory);
}

/** Create a provider by ID. */
export function createProvider(id: string, config: LlmProviderConfig): LlmProvider {
  const factory = providers.get(id);
  if (!factory) {
    throw new Error(`Unknown LLM provider: "${id}". Registered: ${[...providers.keys()].join(', ')}`);
  }
  return factory(config);
}

/** List registered provider IDs. */
export function listProviders(): string[] {
  return [...providers.keys()];
}

/**
 * True for providers that speak the OpenAI Chat Completions wire format
 * (`createOpenAICompatProvider`) rather than the native Anthropic Messages API
 * shape (`createAnthropicProvider`). Shared by the agent runner (`runner.ts`)
 * and the Critic direct-call paths (`critic-inbound.ts`/`critic-outbound.ts`)
 * so every LLM call site — not just `runAgent` — routes OpenAI-compatible
 * providers (e.g. OpenRouter) through the matching adapter instead of a
 * hand-rolled Anthropic-shaped `fetch` (BHG-011).
 */
export function usesOpenAICompatibleProvider(id: string): boolean {
  return id === 'openai' || id === 'openrouter';
}

/**
 * Auto-detect provider from baseUrl.
 * Falls back to 'anthropic' if no match.
 */
export function detectProvider(baseUrl?: string): string {
  if (!baseUrl) return 'anthropic';
  if (baseUrl.includes('api.openai.com')) return 'openai';
  if (baseUrl.includes('openrouter.ai')) return 'openrouter';
  if (baseUrl.includes('z.ai') || baseUrl.includes('zai.')) return 'zai';
  if (baseUrl.includes('api.openai.com')) return 'openai';
  // Default: assume Anthropic-compatible API (direct or proxy)
  return 'anthropic';
}

// ── Anthropic Messages API helpers (shared by all Anthropic-compatible providers) ─

/** Convert LlmChatResponse to the legacy ApiResponse format used by runner.ts */
export function toLegacyApiResponse(response: LlmChatResponse): ApiResponse {
  return {
    content: response.content,
    usage: {
      input_tokens: response.usage.inputTokens,
      output_tokens: response.usage.outputTokens,
      // Issue #1085 (Phase 0): expand-only — omit the key rather than carry
      // an explicit `undefined` when the provider didn't report cache stats.
      ...(response.usage.cacheCreationInputTokens !== undefined
        ? { cache_creation_input_tokens: response.usage.cacheCreationInputTokens }
        : {}),
      ...(response.usage.cacheReadInputTokens !== undefined
        ? { cache_read_input_tokens: response.usage.cacheReadInputTokens }
        : {}),
    },
    stop_reason: response.stopReason,
  };
}

/** Convert legacy ApiResponse to LlmChatResponse */
export function fromLegacyApiResponse(response: ApiResponse): LlmChatResponse {
  return {
    content: response.content,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      // Issue #1085 (Phase 0): see the matching comment in toLegacyApiResponse.
      ...(response.usage.cache_creation_input_tokens !== undefined
        ? { cacheCreationInputTokens: response.usage.cache_creation_input_tokens }
        : {}),
      ...(response.usage.cache_read_input_tokens !== undefined
        ? { cacheReadInputTokens: response.usage.cache_read_input_tokens }
        : {}),
    },
    stopReason: response.stop_reason,
  };
}

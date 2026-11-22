/**
 * Built-in LLM provider registrations.
 *
 * Call registerBuiltinProviders() once at startup to make all
 * built-in providers available via createProvider(id, config).
 */

import type { ProviderId } from '@prompt-studio/types';
import { providerDefaultBaseUrl } from '../provider-ids';
import { type LlmProviderConfig, registerProvider } from '../provider';
import { createAnthropicProvider } from './anthropic';
import { createOpenAICompatProvider } from './openai-compat';

/** Sent as the OpenRouter `HTTP-Referer` when a caller sets no app URL. */
const APP_PUBLIC_URL = 'https://github.com/salir-se/prompt-studio';

export { createAnthropicProvider } from './anthropic';
export { createOpenAICompatProvider } from './openai-compat';

/**
 * Ensure a factory receives a concrete base URL. Without this, a caller that
 * builds a provider directly (e.g. the engine) with only an apiKey would fall
 * through to the factory's generic default — Anthropic for the Anthropic
 * factory, api.openai.com for the OpenAI-compat one — and send the key to the
 * wrong host. Routing through `providerDefaultBaseUrl` keeps the per-provider
 * endpoint as the single source of truth.
 */
function withDefaultBaseUrl(config: LlmProviderConfig, id: ProviderId): LlmProviderConfig {
  return { ...config, baseUrl: config.baseUrl?.trim() ? config.baseUrl : providerDefaultBaseUrl(id) };
}

/** Register all built-in LLM providers. */
export function registerBuiltinProviders(): void {
  // Anthropic (direct) — native Messages API
  registerProvider('anthropic', (config) => createAnthropicProvider(withDefaultBaseUrl(config, 'anthropic')));

  // OpenRouter — OpenAI-compatible, with referrer/title headers
  registerProvider('openrouter', (config) =>
    createOpenAICompatProvider(
      {
        ...withDefaultBaseUrl(config, 'openrouter'),
        appUrl: config.appUrl || APP_PUBLIC_URL,
        appName: config.appName || 'Prompt Studio',
      },
      { id: 'openrouter', name: 'OpenRouter' },
    ),
  );

  // z.ai — Anthropic-compatible Messages API (endpoint: /api/anthropic).
  // It speaks Anthropic's wire format (x-api-key, POST /v1/messages), NOT the
  // OpenAI Chat Completions shape, so it must use the Anthropic factory.
  registerProvider('zai', (config) =>
    createAnthropicProvider(withDefaultBaseUrl(config, 'zai'), { id: 'zai', name: 'z.ai' }),
  );

  // Generic OpenAI-compatible (OpenAI, Groq, Together, Ollama, vLLM, etc.)
  registerProvider('openai', (config) =>
    createOpenAICompatProvider(withDefaultBaseUrl(config, 'openai'), { id: 'openai', name: 'OpenAI' }),
  );

  registerProvider('openai-compat', (config) =>
    createOpenAICompatProvider(config, { id: 'openai-compat', name: 'OpenAI Compatible' }),
  );
}

import type { ProviderId } from '@prompt-studio/types';

/**
 * Canonical API base URLs. Test Connection and runs use the same values, so a passing Test Connection means
 * runs reach the same endpoint.
 */
const PROVIDER_DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  zai: 'https://api.z.ai/api/anthropic',
  openrouter: 'https://openrouter.ai/api',
};

/** Canonical API base URL for a provider; falls back to Anthropic for unknown ids. */
export function providerDefaultBaseUrl(providerId: ProviderId): string {
  return PROVIDER_DEFAULT_BASE_URLS[providerId] ?? PROVIDER_DEFAULT_BASE_URLS.anthropic;
}

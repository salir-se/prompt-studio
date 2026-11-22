/**
 * Extract OpenAI-compatible cached-input counts from a usage object.
 *
 * Chat Completions: `usage.prompt_tokens_details.cached_tokens`
 * Responses API:    `usage.input_tokens_details.cached_tokens`
 *
 * Absent (never `0`) when the provider omitted the field, so callers can
 * distinguish "no cache stats" from "zero cache hits". Issue #1661.
 */
export function openaiCachedInputTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const record = usage as Record<string, unknown>;
  const details = record.prompt_tokens_details ?? record.input_tokens_details;
  if (!details || typeof details !== 'object') return undefined;
  const cached = (details as Record<string, unknown>).cached_tokens;
  if (typeof cached !== 'number' || !Number.isFinite(cached) || cached < 0) return undefined;
  return cached;
}

/** Spread onto `LlmChatResponse.usage` only when a cache count is present. */
export function withOpenAiCacheUsage<T extends { inputTokens: number; outputTokens: number }>(
  usage: T,
  rawUsage: unknown,
): T & { cacheReadInputTokens?: number } {
  const cached = openaiCachedInputTokens(rawUsage);
  return cached === undefined ? usage : { ...usage, cacheReadInputTokens: cached };
}

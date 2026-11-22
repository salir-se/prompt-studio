// @module-tag pure
import { describe, expect, it } from 'vitest';
import { openaiCachedInputTokens, withOpenAiCacheUsage } from './openai-cached-tokens';

describe('openaiCachedInputTokens (#1661)', () => {
  it('reads Chat Completions prompt_tokens_details.cached_tokens', () => {
    expect(
      openaiCachedInputTokens({
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 80 },
      }),
    ).toBe(80);
  });

  it('reads Responses API input_tokens_details.cached_tokens', () => {
    expect(
      openaiCachedInputTokens({
        input_tokens: 100,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: 75 },
      }),
    ).toBe(75);
  });

  it('is absent when the provider omitted cache details', () => {
    expect(openaiCachedInputTokens({ prompt_tokens: 100, completion_tokens: 20 })).toBeUndefined();
    expect(openaiCachedInputTokens(undefined)).toBeUndefined();
    expect(openaiCachedInputTokens({ prompt_tokens_details: { cached_tokens: -1 } })).toBeUndefined();
  });

  it('spreads cacheReadInputTokens only when a count is present', () => {
    expect(withOpenAiCacheUsage({ inputTokens: 10, outputTokens: 2 }, { prompt_tokens: 10 })).toEqual({
      inputTokens: 10,
      outputTokens: 2,
    });
    expect(
      withOpenAiCacheUsage(
        { inputTokens: 10, outputTokens: 2 },
        { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 8 } },
      ),
    ).toEqual({ inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 8 });
  });
});

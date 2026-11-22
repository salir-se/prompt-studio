// @module-tag pure
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmChatResponse, LlmProvider } from './provider';
import {
  createProvider,
  detectProvider,
  fromLegacyApiResponse,
  listProviders,
  registerProvider,
  toLegacyApiResponse,
} from './provider';

describe('detectProvider', () => {
  it('returns anthropic for no baseUrl', () => {
    expect(detectProvider()).toBe('anthropic');
    expect(detectProvider(undefined)).toBe('anthropic');
  });

  it('detects openrouter', () => {
    expect(detectProvider('https://openrouter.ai/api')).toBe('openrouter');
  });

  it('detects direct OpenAI', () => {
    expect(detectProvider('https://api.openai.com')).toBe('openai');
  });

  it('detects zai', () => {
    expect(detectProvider('https://api.z.ai')).toBe('zai');
    expect(detectProvider('https://zai.example.com')).toBe('zai');
  });

  it('defaults to anthropic for unknown URLs', () => {
    expect(detectProvider('https://my-proxy.example.com')).toBe('anthropic');
  });
});

describe('provider registry', () => {
  afterEach(() => {
    // Registry is module-level, tests may leak state
  });

  it('registerProvider + createProvider roundtrip', () => {
    const mockProvider: LlmProvider = {
      id: 'test-provider',
      name: 'Test',
      chat: vi.fn(),
      chatStream: vi.fn(),
      testConnection: vi.fn(),
    };

    registerProvider('test-provider', () => mockProvider);
    const provider = createProvider('test-provider', { apiKey: 'key' });
    expect(provider.id).toBe('test-provider');
    expect(provider.name).toBe('Test');
  });

  it('createProvider throws for unknown provider', () => {
    expect(() => createProvider('nonexistent', { apiKey: 'key' })).toThrow('Unknown LLM provider');
  });

  it('listProviders includes registered providers', () => {
    registerProvider('list-test', () => ({
      id: 'list-test',
      name: 'List Test',
      chat: vi.fn(),
      chatStream: vi.fn(),
      testConnection: vi.fn(),
    }));

    expect(listProviders()).toContain('list-test');
  });
});

describe('format conversion', () => {
  it('toLegacyApiResponse converts correctly', () => {
    const response: LlmChatResponse = {
      content: [{ type: 'text', text: 'hello' }],
      usage: { inputTokens: 100, outputTokens: 50 },
      stopReason: 'end_turn',
    };

    const legacy = toLegacyApiResponse(response);
    expect(legacy.usage.input_tokens).toBe(100);
    expect(legacy.usage.output_tokens).toBe(50);
    expect(legacy.stop_reason).toBe('end_turn');
    expect(legacy.content).toEqual(response.content);
  });

  it('fromLegacyApiResponse converts correctly', () => {
    const legacy = {
      content: [{ type: 'text', text: 'world' }],
      usage: { input_tokens: 200, output_tokens: 80 },
      stop_reason: 'tool_use',
    };

    const response = fromLegacyApiResponse(legacy);
    expect(response.usage.inputTokens).toBe(200);
    expect(response.usage.outputTokens).toBe(80);
    expect(response.stopReason).toBe('tool_use');
    expect(response.content).toEqual(legacy.content);
  });

  it('roundtrip preserves data', () => {
    const original: LlmChatResponse = {
      content: [
        { type: 'text', text: 'analysis' },
        { type: 'tool_use', id: 'tc1', name: 'save_lead', input: { company: 'Acme' } },
      ],
      usage: { inputTokens: 500, outputTokens: 200 },
      stopReason: 'tool_use',
    };

    const roundtripped = fromLegacyApiResponse(toLegacyApiResponse(original));
    expect(roundtripped.content).toEqual(original.content);
    expect(roundtripped.usage).toEqual(original.usage);
    expect(roundtripped.stopReason).toBe(original.stopReason);
  });

  // Issue #1085 (Phase 0): prompt-cache usage threaded through the legacy
  // conversion helpers unchanged, in both directions.
  describe('prompt-cache usage (issue #1085 Phase 0)', () => {
    it('toLegacyApiResponse maps cache fields when present', () => {
      const response: LlmChatResponse = {
        content: [],
        usage: { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 800, cacheReadInputTokens: 1200 },
        stopReason: 'end_turn',
      };

      const legacy = toLegacyApiResponse(response);
      expect(legacy.usage.cache_creation_input_tokens).toBe(800);
      expect(legacy.usage.cache_read_input_tokens).toBe(1200);
    });

    it('fromLegacyApiResponse maps cache fields when present', () => {
      const legacy = {
        content: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 800,
          cache_read_input_tokens: 1200,
        },
        stop_reason: 'end_turn',
      };

      const response = fromLegacyApiResponse(legacy);
      expect(response.usage.cacheCreationInputTokens).toBe(800);
      expect(response.usage.cacheReadInputTokens).toBe(1200);
    });

    it('leaves cache fields undefined (never 0/NaN) when the source omits them', () => {
      const response: LlmChatResponse = {
        content: [],
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      };

      const legacy = toLegacyApiResponse(response);
      expect(legacy.usage.cache_creation_input_tokens).toBeUndefined();
      expect(legacy.usage.cache_read_input_tokens).toBeUndefined();

      const roundtripped = fromLegacyApiResponse(legacy);
      expect(roundtripped.usage.cacheCreationInputTokens).toBeUndefined();
      expect(roundtripped.usage.cacheReadInputTokens).toBeUndefined();
    });

    it('roundtrip preserves cache fields', () => {
      const original: LlmChatResponse = {
        content: [{ type: 'text', text: 'analysis' }],
        usage: { inputTokens: 500, outputTokens: 200, cacheCreationInputTokens: 4000, cacheReadInputTokens: 9000 },
        stopReason: 'end_turn',
      };

      const roundtripped = fromLegacyApiResponse(toLegacyApiResponse(original));
      expect(roundtripped.usage).toEqual(original.usage);
    });
  });
});

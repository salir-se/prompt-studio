// @module-tag pure
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_TOKENS,
  outputTokenCeilingFor,
  reasonsByDefault,
  requiresResponsesApiForTools,
  resolveReasoningConfig,
  resolveThinkingConfig,
  supportsAdaptiveThinking,
  supportsReasoningEffort,
  THINKING_MAX_TOKENS,
} from './thinking-config';

// ── Constants ────────────────────────────────────────────────────────────

describe('constants', () => {
  it('DEFAULT_MAX_TOKENS is 8192', () => {
    expect(DEFAULT_MAX_TOKENS).toBe(8192);
  });

  it('THINKING_MAX_TOKENS is 32768', () => {
    expect(THINKING_MAX_TOKENS).toBe(32_768);
  });
});

// ── outputTokenCeilingFor ──────────────────────────────────────────────

/**
 * The ceiling a call gets when it asks for neither thinking nor a reasoning effort. `runner.ts` and
 * the Sales app's prompt tools both read it here so they cannot drift — they did drift, and the
 * wizard ended up asking a reasoning model to rewrite a 3,645-token prompt inside 4,000 tokens
 * (salir-se/salir#1757).
 */
describe('outputTokenCeilingFor', () => {
  it.each(['glm-5.3-flash', 'gpt-5.6-terra', 'anthropic/claude-opus-5'])(
    'gives %s the thinking headroom, because it reasons whether or not we asked',
    (model) => {
      expect(outputTokenCeilingFor(model)).toBe(THINKING_MAX_TOKENS);
    },
  );

  it.each(['claude-sonnet-4-6', 'claude-haiku-4-5'])('gives %s the ordinary ceiling', (model) => {
    expect(outputTokenCeilingFor(model)).toBe(DEFAULT_MAX_TOKENS);
  });

  it('treats a missing model as ordinary rather than throwing', () => {
    expect(outputTokenCeilingFor(undefined)).toBe(DEFAULT_MAX_TOKENS);
  });
});

// ── supportsAdaptiveThinking ───────────────────────────────────────────

describe('supportsAdaptiveThinking', () => {
  describe('true: current Anthropic 4.6+ families', () => {
    it.each([
      'claude-sonnet-4-6',
      'claude-sonnet-5',
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      // Both were selectable in the model catalog while missing from the
      // allow-list, so the two most capable models ran with no thinking
      // config and the answer-sized 8192 cap.
      'claude-opus-5',
      'claude-fable-5',
    ])('%s -> true', (model) => {
      expect(supportsAdaptiveThinking(model)).toBe(true);
    });
  });

  describe('true: with anthropic/ route prefix (OpenRouter)', () => {
    it.each(['anthropic/claude-sonnet-4-6', 'anthropic/claude-opus-4-8'])('%s -> true', (model) => {
      expect(supportsAdaptiveThinking(model)).toBe(true);
    });
  });

  describe('true: z.ai GLM reasoning models', () => {
    it.each([
      'glm-4.6',
      'glm-5',
      'glm-5.1',
      'z-ai/glm-5.2', // routed id -- still matched by the "contains glm" substring rule
    ])('%s -> true', (model) => {
      expect(supportsAdaptiveThinking(model)).toBe(true);
    });
  });

  describe('true: case-insensitive matching', () => {
    it.each(['CLAUDE-SONNET-4-6', 'Claude-Opus-4-8', 'GLM-4.6'])('%s -> true', (model) => {
      expect(supportsAdaptiveThinking(model)).toBe(true);
    });
  });

  describe('true: dated suffix after the version still matches (boundary is "-" or end-of-string)', () => {
    it('claude-sonnet-4-6-20260115 -> true', () => {
      expect(supportsAdaptiveThinking('claude-sonnet-4-6-20260115')).toBe(true);
    });
  });

  describe('false: older Claude generations', () => {
    it.each([
      'claude-3-5-sonnet',
      'claude-3-opus',
      'claude-sonnet-4-0',
      'claude-opus-4-0',
      'claude-opus-4-1',
      'claude-sonnet-4-5',
      'claude-opus-4-5',
      // Live-API-verified (2026-07-05): Messages API 400s adaptive on haiku-4-5;
      // Models API reports thinking.types.adaptive.supported=false. Only the
      // legacy budget_tokens mode exists there, which this module never sends.
      'claude-haiku-4-5',
      'anthropic/claude-haiku-4-5',
    ])('%s -> false', (model) => {
      expect(supportsAdaptiveThinking(model)).toBe(false);
    });
  });

  describe('false: OpenAI models', () => {
    it.each(['gpt-4o', 'gpt-5', 'o1-preview', 'o3-mini'])('%s -> false', (model) => {
      expect(supportsAdaptiveThinking(model)).toBe(false);
    });
  });

  describe('false: empty and unknown names', () => {
    it.each(['', 'mistral-large', 'llama-3-70b'])('%j -> false', (model) => {
      expect(supportsAdaptiveThinking(model)).toBe(false);
    });
  });

  describe('false: a longer id must not false-positive-match a shorter allow-listed prefix', () => {
    it.each(['claude-sonnet-4-60', 'claude-opus-4-88'])('%s -> false', (model) => {
      expect(supportsAdaptiveThinking(model)).toBe(false);
    });
  });
});

// ── resolveThinkingConfig ──────────────────────────────────────────────

describe('resolveThinkingConfig', () => {
  describe('enabled === false always wins, regardless of provider/model', () => {
    it.each([
      { providerId: 'anthropic', model: 'claude-sonnet-4-6' },
      { providerId: 'openai', model: 'gpt-5' },
      { providerId: 'unknown-provider', model: '' },
    ])('providerId=$providerId model=$model -> default, no thinking', ({ providerId, model }) => {
      const result = resolveThinkingConfig({ providerId, model, enabled: false });
      expect(result).toEqual({ maxTokens: DEFAULT_MAX_TOKENS });
    });

    it('omits the `thinking` key entirely rather than setting it to undefined', () => {
      const result = resolveThinkingConfig({ providerId: 'anthropic', model: 'claude-sonnet-4-6', enabled: false });
      expect('thinking' in result).toBe(false);
    });
  });

  describe('enabled === true, Claude 4.6+ model -> adaptive thinking', () => {
    it.each([
      { providerId: 'anthropic', model: 'claude-sonnet-4-6' },
      { providerId: 'openrouter', model: 'anthropic/claude-opus-4-8' },
    ])('providerId=$providerId model=$model -> adaptive + THINKING_MAX_TOKENS', ({ providerId, model }) => {
      const result = resolveThinkingConfig({ providerId, model, enabled: true });
      expect(result).toEqual({
        thinking: { type: 'adaptive', display: 'summarized' },
        maxTokens: THINKING_MAX_TOKENS,
      });
    });

    it('never includes budget_tokens on the thinking block', () => {
      const result = resolveThinkingConfig({ providerId: 'anthropic', model: 'claude-sonnet-4-6', enabled: true });
      expect(result.thinking).toBeDefined();
      expect(result.thinking && 'budget_tokens' in result.thinking).toBe(false);
    });
  });

  // z.ai routes through its Anthropic-compatible endpoint but GLM thinking is
  // `{type:'enabled'}`, NOT Claude 4.6+ `{type:'adaptive'}` — sending adaptive is
  // rejected by z.ai. (docs.z.ai/guides/capabilities/thinking-mode)
  describe('enabled === true, z.ai (GLM) -> {type:enabled} thinking, never adaptive', () => {
    it.each([{ model: 'glm-4.6' }, { model: 'glm-5' }, { model: 'glm-5.1' }])(
      'providerId=zai model=$model -> {type:enabled} + THINKING_MAX_TOKENS',
      ({ model }) => {
        const result = resolveThinkingConfig({ providerId: 'zai', model, enabled: true });
        expect(result).toEqual({ thinking: { type: 'enabled' }, maxTokens: THINKING_MAX_TOKENS });
      },
    );

    it('never sends z.ai the Anthropic adaptive shape or a display field', () => {
      const result = resolveThinkingConfig({ providerId: 'zai', model: 'glm-4.6', enabled: true });
      expect(result.thinking).toEqual({ type: 'enabled' });
      expect(result.thinking && 'display' in result.thinking).toBe(false);
    });
  });

  describe('enabled === true, but provider does not speak the Anthropic thinking wire -> default', () => {
    it.each([
      { providerId: 'openai', model: 'claude-sonnet-4-6' }, // model would qualify, but provider gates it
      { providerId: 'openai', model: 'gpt-5' },
      { providerId: 'openrouter', model: 'mistral-large' }, // no anthropic/ prefix
      { providerId: 'unknown-provider', model: 'claude-sonnet-4-6' },
    ])('providerId=$providerId model=$model -> default, no thinking', ({ providerId, model }) => {
      const result = resolveThinkingConfig({ providerId, model, enabled: true });
      expect(result).toEqual({ maxTokens: DEFAULT_MAX_TOKENS });
    });

    it('openrouter + z-ai/glm-4.6: glm content alone does not send thinking, but GLM reasons anyway', () => {
      const result = resolveThinkingConfig({ providerId: 'openrouter', model: 'z-ai/glm-4.6', enabled: true });
      expect(result).toEqual({ maxTokens: THINKING_MAX_TOKENS });
    });
  });

  // Hosted (Workers AI `@cf/zai-org/glm-5.3-flash`) is a reasoning model that
  // speaks the OpenAI wire, so it never gets a `thinking` block. Its reasoning
  // still bills against max_tokens: at 8192 a Scout run (staging, 2026-09-14,
  // run 884582b9) spent the whole budget reasoning and returned zero content.
  describe('hosted GLM reasons by default -> no thinking block, THINKING_MAX_TOKENS headroom', () => {
    it.each([true, false])('enabled=%s -> THINKING_MAX_TOKENS, no thinking', (enabled) => {
      expect(resolveThinkingConfig({ providerId: 'hosted', model: 'glm-5.3-flash', enabled })).toEqual({
        maxTokens: THINKING_MAX_TOKENS,
      });
    });
  });

  describe('enabled === true, Anthropic-wire provider, but unsupported model -> default', () => {
    it.each([
      { providerId: 'anthropic', model: 'claude-3-5-sonnet' },
      { providerId: 'zai', model: 'gpt-4o' },
      { providerId: 'openrouter', model: 'anthropic/claude-3-5-sonnet' }, // prefixed, but unsupported model
    ])('providerId=$providerId model=$model -> default, no thinking', ({ providerId, model }) => {
      const result = resolveThinkingConfig({ providerId, model, enabled: true });
      expect(result).toEqual({ maxTokens: DEFAULT_MAX_TOKENS });
    });
  });
});

// ── supportsReasoningEffort ────────────────────────────────────────────

describe('supportsReasoningEffort', () => {
  describe('openai: reasoning-capable model families -> true', () => {
    it.each([
      'gpt-5',
      'gpt-5-mini',
      'gpt-5.1',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.6',
      'o1',
      'o1-mini',
      'o3',
      'o3-mini',
      'o4-mini',
    ])('openai + %s -> true', (model) => {
      expect(supportsReasoningEffort('openai', model)).toBe(true);
    });
  });

  describe('openai: GPT-4-era models reject the parameter -> false', () => {
    it.each(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'])('openai + %s -> false', (model) => {
      expect(supportsReasoningEffort('openai', model)).toBe(false);
    });
  });

  describe('openai: case-insensitive matching', () => {
    it.each(['GPT-5.6-SOL', 'O3-MINI'])('openai + %s -> true', (model) => {
      expect(supportsReasoningEffort('openai', model)).toBe(true);
    });
  });

  describe('openrouter: unified reasoning param normalized per upstream -> always true', () => {
    it.each(['anthropic/claude-sonnet-4-6', 'openai/gpt-5.6-terra', 'mistral-large', ''])(
      'openrouter + %s -> true',
      (model) => {
        expect(supportsReasoningEffort('openrouter', model)).toBe(true);
      },
    );
  });

  describe('every other provider -> false', () => {
    it.each([
      { providerId: 'anthropic', model: 'claude-sonnet-4-6' },
      { providerId: 'zai', model: 'glm-4.6' },
      { providerId: 'unknown-provider', model: 'gpt-5.6-sol' },
    ])('providerId=$providerId model=$model -> false', ({ providerId, model }) => {
      expect(supportsReasoningEffort(providerId, model)).toBe(false);
    });
  });
});

// ── resolveReasoningConfig ─────────────────────────────────────────────

describe('resolveReasoningConfig', () => {
  describe('effort undefined -> never sent', () => {
    it.each([
      { providerId: 'openai', model: 'gpt-5.6-sol' },
      { providerId: 'openai', model: 'gpt-5-mini' },
      { providerId: 'openrouter', model: 'anthropic/claude-sonnet-4-6' },
      { providerId: 'anthropic', model: 'claude-sonnet-4-6' },
    ])('providerId=$providerId model=$model -> no reasoningEffort', ({ providerId, model }) => {
      expect(resolveReasoningConfig({ providerId, model }).reasoningEffort).toBeUndefined();
    });

    it.each([
      { providerId: 'openai', model: 'gpt-5-mini' },
      { providerId: 'openrouter', model: 'anthropic/claude-sonnet-4-6' },
      { providerId: 'anthropic', model: 'claude-sonnet-4-6' },
    ])('providerId=$providerId model=$model -> DEFAULT_MAX_TOKENS', ({ providerId, model }) => {
      expect(resolveReasoningConfig({ providerId, model })).toEqual({ maxTokens: DEFAULT_MAX_TOKENS });
    });

    it.each([{ model: 'gpt-5.6-sol' }, { model: 'gpt-5.6-terra' }, { model: 'gpt-5.6' }])(
      '$model reasons by DEFAULT, so it still gets THINKING_MAX_TOKENS headroom',
      ({ model }) => {
        // Sending no `reasoning_effort` does not mean no reasoning on this
        // family — it means the model's own default (`medium`), billed against
        // the same output budget as the answer. Sized for answer-only output,
        // a long reasoning pass truncates the answer.
        expect(resolveReasoningConfig({ providerId: 'openai', model })).toEqual({ maxTokens: THINKING_MAX_TOKENS });
      },
    );

    it('omits the `reasoningEffort` key entirely rather than setting it to undefined', () => {
      const result = resolveReasoningConfig({ providerId: 'openai', model: 'gpt-5.6-sol' });
      expect('reasoningEffort' in result).toBe(false);
    });
  });

  describe('effort set, but provider/model does not support it -> default, never sent', () => {
    it.each([
      { providerId: 'openai', model: 'gpt-4o-mini', effort: 'high' as const },
      { providerId: 'openai', model: 'gpt-4.1', effort: 'medium' as const },
      { providerId: 'anthropic', model: 'claude-sonnet-4-6', effort: 'high' as const },
      { providerId: 'zai', model: 'glm-4.6', effort: 'high' as const },
      { providerId: 'unknown-provider', model: 'gpt-5.6-sol', effort: 'high' as const },
    ])('providerId=$providerId model=$model effort=$effort -> default, no reasoningEffort', (input) => {
      const result = resolveReasoningConfig(input);
      expect(result).toEqual({ maxTokens: DEFAULT_MAX_TOKENS });
    });
  });

  describe("effort === 'none' on a supported model -> explicitly disables, DEFAULT_MAX_TOKENS", () => {
    it.each([
      { providerId: 'openai', model: 'gpt-5.6-sol' },
      { providerId: 'openai', model: 'gpt-5-mini' },
      { providerId: 'openai', model: 'o3-mini' },
      { providerId: 'openrouter', model: 'anthropic/claude-sonnet-4-6' },
    ])('providerId=$providerId model=$model -> {reasoningEffort:none}', ({ providerId, model }) => {
      const result = resolveReasoningConfig({ providerId, model, effort: 'none' });
      expect(result).toEqual({ reasoningEffort: 'none', maxTokens: DEFAULT_MAX_TOKENS });
    });
  });

  describe('effort set to a real level on a supported model -> sent, THINKING_MAX_TOKENS headroom', () => {
    it.each([
      { providerId: 'openai', model: 'gpt-5.6-sol', effort: 'medium' as const },
      { providerId: 'openai', model: 'gpt-5.6-terra', effort: 'max' as const },
      { providerId: 'openai', model: 'gpt-5.6-luna', effort: 'low' as const },
      { providerId: 'openai', model: 'gpt-5.6', effort: 'high' as const },
      { providerId: 'openai', model: 'gpt-5-mini', effort: 'minimal' as const },
      { providerId: 'openai', model: 'o3-mini', effort: 'xhigh' as const },
      { providerId: 'openrouter', model: 'anthropic/claude-sonnet-4-6', effort: 'medium' as const },
      { providerId: 'openrouter', model: 'openai/gpt-5.6-terra', effort: 'high' as const },
    ])('providerId=$providerId model=$model effort=$effort -> sent + THINKING_MAX_TOKENS', (input) => {
      const result = resolveReasoningConfig(input);
      expect(result).toEqual({ reasoningEffort: input.effort, maxTokens: THINKING_MAX_TOKENS });
    });
  });

  describe('case-insensitivity on model', () => {
    it('openai + GPT-5.6-SOL + medium -> sent', () => {
      const result = resolveReasoningConfig({ providerId: 'openai', model: 'GPT-5.6-SOL', effort: 'medium' });
      expect(result).toEqual({ reasoningEffort: 'medium', maxTokens: THINKING_MAX_TOKENS });
    });
  });
});

// ── reasonsByDefault / requiresResponsesApiForTools ──────────────────────

describe('reasonsByDefault', () => {
  it.each(['gpt-5.6', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra-2026-01-15'])(
    '%s reasons by default',
    (model) => {
      expect(reasonsByDefault(model)).toBe(true);
    },
  );

  // Cloudflare lists glm-5.3-flash as a Reasoning model; GLM emits reasoning
  // unprompted on every route (Workers AI, z.ai, OpenRouter).
  it.each(['glm-5.3-flash', 'glm-5.1', 'GLM-4.6', 'z-ai/glm-5.2'])('GLM %s reasons by default', (model) => {
    expect(reasonsByDefault(model)).toBe(true);
  });

  it.each(['gpt-5', 'gpt-5-mini', 'gpt-5.1', 'gpt-5.5', 'o3-mini', 'gpt-4o', 'claude-sonnet-4-6'])(
    '%s does not',
    (model) => {
      expect(reasonsByDefault(model)).toBe(false);
    },
  );

  it('resolves an OpenRouter-routed id the same as a bare one', () => {
    expect(reasonsByDefault('openai/gpt-5.6-terra')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(reasonsByDefault('GPT-5.6-TERRA')).toBe(true);
  });

  it('does not match a longer version that merely starts with the same digits', () => {
    expect(reasonsByDefault('gpt-5.60-experimental')).toBe(false);
  });
});

describe('requiresResponsesApiForTools', () => {
  it.each(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'])('supports reasoning and tool calls for %s', (model) => {
    expect(supportsReasoningEffort('openai', model)).toBe(true);
    expect(reasonsByDefault(model)).toBe(true);
    expect(requiresResponsesApiForTools(model)).toBe(true);
    expect(requiresResponsesApiForTools(model, 'high')).toBe(true);
  });

  it.each([undefined, 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'gpt-5.6-terra with effort=%s needs the Responses API',
    (effort) => {
      // `undefined` is the important one: the model reasons at `medium`
      // anyway, which is what Chat Completions refuses alongside tools.
      expect(requiresResponsesApiForTools('gpt-5.6-terra', effort)).toBe(true);
    },
  );

  it('stays on chat completions when reasoning is explicitly turned off', () => {
    expect(requiresResponsesApiForTools('gpt-5.6-terra', 'none')).toBe(false);
  });

  it.each(['gpt-5-mini', 'o3-mini', 'gpt-4o'])('%s never needs it', (model) => {
    expect(requiresResponsesApiForTools(model, 'high')).toBe(false);
  });
});

// ── Anthropic models that think whether or not we ask ────────────────────

describe('Anthropic models that reason by default', () => {
  it.each(['claude-opus-5', 'claude-fable-5'])('%s reasonsByDefault', (model) => {
    // Opus 5 runs adaptive when `thinking` is omitted; Fable 5's thinking
    // cannot be disabled at all.
    expect(reasonsByDefault(model)).toBe(true);
  });

  it.each(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-3-5-sonnet'])(
    '%s does not reason unless asked',
    (model) => {
      expect(reasonsByDefault(model)).toBe(false);
    },
  );

  it('resolves an OpenRouter-routed Anthropic id the same as a bare one', () => {
    expect(reasonsByDefault('anthropic/claude-opus-5')).toBe(true);
  });

  it.each(['claude-opus-5', 'claude-fable-5'])(
    '%s gets THINKING_MAX_TOKENS headroom even with capture OFF',
    (model) => {
      // The thinking happens regardless and bills against the same budget as
      // the answer, so a cap sized for answer-only output truncates it.
      expect(resolveThinkingConfig({ providerId: 'anthropic', model, enabled: false })).toEqual({
        maxTokens: THINKING_MAX_TOKENS,
      });
    },
  );

  it.each(['claude-opus-5', 'claude-fable-5'])('%s requests adaptive thinking when capture is ON', (model) => {
    expect(resolveThinkingConfig({ providerId: 'anthropic', model, enabled: true })).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      maxTokens: THINKING_MAX_TOKENS,
    });
  });

  it('still gives a non-default-reasoning model the plain budget when capture is OFF', () => {
    expect(resolveThinkingConfig({ providerId: 'anthropic', model: 'claude-opus-4-8', enabled: false })).toEqual({
      maxTokens: DEFAULT_MAX_TOKENS,
    });
  });

  it('never routes an Anthropic model to the OpenAI Responses endpoint', () => {
    // `reasonsByDefault` spans vendors; the endpoint constraint does not.
    expect(requiresResponsesApiForTools('claude-opus-5')).toBe(false);
    expect(requiresResponsesApiForTools('claude-fable-5', 'high')).toBe(false);
  });
});

/**
 * Per-provider/model resolution of Anthropic-style "adaptive" extended
 * thinking, plus the `max_tokens` to request alongside it. Also resolves the
 * separate OpenAI/OpenRouter `reasoning_effort` request shape (see
 * {@link resolveReasoningConfig}).
 *
 * WHY adaptive, not `budget_tokens`: Claude 4.6+ models support a thinking
 * mode where the model itself decides how much to think (`{ type: 'adaptive'
 * }`), replacing the older fixed `budget_tokens` knob. Adaptive is the
 * correct mode for these models, so this module (and anything built on top
 * of it) must never emit `budget_tokens`. Older models don't support `type:
 * 'adaptive'` at all, so they are intentionally excluded here (kept
 * `false`/no-thinking) rather than falling back to a `budget_tokens`
 * request -- that keeps Phase 1 of the thinking rollout safe: turning
 * thinking "on" either gets you the modern adaptive mode or an inert no-op,
 * never a legacy/unsupported request shape.
 *
 * WHY `display: 'summarized'`: Claude 4.6+ defaults thinking display to
 * `'omitted'`, which returns empty thinking text to the caller. Requesting
 * `'summarized'` explicitly is what makes the thinking readable at all, so
 * every enabled+supported branch below sets it.
 *
 * Pure module: no I/O, no network, no imports beyond types (a type-only
 * import of the shared `ReasoningEffort` from `@prompt-studio/types` is the one
 * exception -- it's erased at compile time, so it doesn't add a runtime
 * dependency). Wired into the LLM providers by a later task -- this file
 * only decides the request fragment.
 */

import type { ReasoningEffort } from '@prompt-studio/types';

export type { ReasoningEffort };

/**
 * `max_tokens` for a request that does not enable thinking.
 *
 * NOTE this is an OUTPUT cap, not a context-window budget — raising it does
 * not consume input context. It was 4096 from the original package
 * extraction, inherited from the Claude-3-era output ceiling and never
 * revisited; every model we now run has a far higher ceiling.
 *
 * Sized against measured Closer output (p90 draft 378 tok, worst observed
 * call ~1,405 tok including reasoning) with room for a full multi-section
 * `PROPOSAL_TEMPLATE`/`ACTION_PLAN_TEMPLATE` generation. Reasoning models
 * bill their thinking against this same budget EVEN WHEN thinking was never
 * requested — GLM-5.3 emits it unprompted (measured: up to 3,158 chars ≈ 790
 * tok) — so the no-thinking path still needs headroom above the answer size.
 */
export const DEFAULT_MAX_TOKENS = 8192;

/**
 * `max_tokens` once adaptive thinking is requested. Thinking output shares
 * the same token budget as the final answer, so this needs far more headroom
 * than the default: adaptive thinking decides its own depth, and a hard
 * problem can spend well over 8K tokens reasoning before it writes a word.
 *
 * At 8192 a long reasoning pass could consume the entire budget and leave the
 * answer truncated — the exact failure that silently degraded Critic Inbound
 * to `minimalBrief` at `max_tokens: 1500`.
 */
export const THINKING_MAX_TOKENS = 32_768;

/**
 * `max_tokens` for a call that requests neither thinking nor a reasoning
 * effort — the ordinary case, and the only case the Sales app's prompt tools
 * are ever in, since they call `provider.chat` directly rather than through
 * `runner.ts`.
 *
 * A model that reasons by default still reasons, and bills it against this same
 * budget before it writes an answer token, so it needs the thinking headroom
 * even though nothing asked for thinking. `runner.ts` has always done this for
 * agent runs; extracted here so the two callers cannot drift, because the
 * places that did not share it drifted exactly as expected: the wizard asked a
 * `reasoning_effort: medium` Hosted model to rewrite a 3,645-token Critic
 * prompt inside 4,000 tokens (salir-se/salir#1757).
 *
 * It is a CEILING, not a reservation: a short answer bills what it produced.
 */
export function outputTokenCeilingFor(model: string | undefined): number {
  return reasonsByDefault(model ?? '') ? THINKING_MAX_TOKENS : DEFAULT_MAX_TOKENS;
}

/** OpenRouter-style routing prefix for Anthropic models, e.g. `anthropic/claude-sonnet-4-6`. */
const ANTHROPIC_ROUTE_PREFIX = 'anthropic/';

/**
 * Anthropic model families that support `{ type: 'adaptive' }` thinking --
 * Claude 4.6 and newer. Each pattern matches the bare model id and requires
 * the version to be followed by `-` (a dated suffix, e.g. `-20260115`) or
 * the end of the string, so a similarly-prefixed but different id (e.g. a
 * hypothetical `claude-sonnet-4-60`) cannot false-positive-match.
 *
 * This is an explicit allow-list, not a version-number heuristic. Notably
 * `claude-haiku-4-5` is NOT listed: the live Messages API rejects adaptive
 * on it with 400 "adaptive thinking is not supported on this model", and
 * the Models API reports `thinking.types.adaptive.supported: false` (Haiku
 * 4.5 only has the legacy `budget_tokens` mode, which this module never
 * emits) -- so like the rest of the pre-4.6 "-4-5" line it resolves to the
 * safe no-thinking default.
 */
const ADAPTIVE_THINKING_ANTHROPIC_PATTERNS: readonly RegExp[] = [
  /^claude-sonnet-4-6(-|$)/, // Claude Sonnet 4.6
  /^claude-sonnet-5(-|$)/, // Claude Sonnet 5
  /^claude-opus-4-6(-|$)/, // Claude Opus 4.6
  /^claude-opus-4-7(-|$)/, // Claude Opus 4.7
  /^claude-opus-4-8(-|$)/, // Claude Opus 4.8
  // Opus 5 and Fable 5 were missing here while already being selectable in the
  // model catalog, so the two most capable models resolved to no-thinking and
  // the answer-sized 8192 cap. They think either way -- Opus 5 runs adaptive
  // when `thinking` is omitted, and Fable 5's thinking cannot be turned off at
  // all -- so the only thing the omission bought was a truncated answer.
  /^claude-opus-5(-|$)/, // Claude Opus 5
  /^claude-fable-5(-|$)/, // Claude Fable 5
];

/** Strip an OpenRouter-style `anthropic/` routing prefix, if present. */
function stripAnthropicRoutePrefix(model: string): string {
  return model.startsWith(ANTHROPIC_ROUTE_PREFIX) ? model.slice(ANTHROPIC_ROUTE_PREFIX.length) : model;
}

/**
 * True for models that support Anthropic-style ADAPTIVE thinking
 * (`{type:'adaptive'}`). Adaptive thinking (no budget_tokens) is the correct
 * mode on Claude 4.6+ models; older models are intentionally excluded (kept
 * `false`) so Phase 1 stays safe. Case-insensitive.
 */
export function supportsAdaptiveThinking(model: string): boolean {
  const lower = model.toLowerCase();

  // z.ai GLM reasoning models: matched by substring anywhere in the id, so
  // both a bare id (`glm-4.6`) and a routed one (`z-ai/glm-5.1`) qualify.
  if (lower.includes('glm')) return true;

  const bare = stripAnthropicRoutePrefix(lower);
  return ADAPTIVE_THINKING_ANTHROPIC_PATTERNS.some((pattern) => pattern.test(bare));
}

/**
 * True when `providerId`/`model` speaks the Anthropic Messages API wire
 * format directly -- required for `{ type: 'adaptive' }` thinking, which is
 * an Anthropic-specific request shape. `anthropic` and `zai` carry the
 * Anthropic wire format as-is; `openrouter` only does when routing to an
 * `anthropic/`-prefixed model (OpenRouter otherwise translates the request
 * into each upstream's own format).
 *
 * OpenAI reasoning models support thinking via a different request shape
 * (`reasoning_effort`), not this Anthropic `thinking` block -- see
 * {@link resolveReasoningConfig} for that. `'openai'` (and any other
 * non-Anthropic-wire provider) always resolves to the safe no-thinking
 * default in `resolveThinkingConfig`; it's a separate request shape, not a
 * feature gap in this function.
 */
function usesAnthropicWire(providerId: string, model: string): boolean {
  if (providerId === 'anthropic' || providerId === 'zai') return true;
  return providerId === 'openrouter' && model.toLowerCase().startsWith(ANTHROPIC_ROUTE_PREFIX);
}

/** Input to {@link resolveThinkingConfig}. */
export interface ResolveThinkingConfigInput {
  /** LLM provider id, e.g. `'anthropic'`, `'zai'`, `'openrouter'`, `'openai'`. Unrecognized ids are treated as non-Anthropic-wire. */
  providerId: string;
  model: string;
  /** Caller's request to enable thinking (typically a user/org setting). */
  enabled: boolean;
}

/**
 * Anthropic Messages API `thinking` request fragment. Shared by every
 * Anthropic-wire call site (provider request bodies, `ApiConfig`) so the
 * shape is declared once. Always `type: 'adaptive'` -- never `budget_tokens`
 * (see the module doc above for why).
 */
export type AdaptiveThinkingParam = { type: 'adaptive'; display: 'summarized' };

/**
 * z.ai (GLM) thinking request fragment. z.ai's Anthropic-compatible endpoint
 * (`api.z.ai/api/anthropic`) does NOT accept Claude 4.6+ `{type:'adaptive'}`;
 * GLM thinking is toggled with `{type:'enabled'}` (docs.z.ai/guides/capabilities/thinking-mode).
 */
export type ZaiThinkingParam = { type: 'enabled' };

/** Any provider's thinking request fragment (spread into the request body). */
export type ThinkingParam = AdaptiveThinkingParam | ZaiThinkingParam;

/** Result of {@link resolveThinkingConfig} -- spread directly into the provider request body. */
export interface ThinkingConfig {
  /** Present only when thinking is actually requested; provider-specific shape. */
  thinking?: ThinkingParam;
  maxTokens: number;
}

/**
 * Provider/model-aware thinking request fragment + max_tokens. When
 * disabled, or when the provider/model can't do Anthropic-style thinking,
 * returns NO `thinking` and the current default max_tokens (4096) -- a safe
 * no-op.
 */
export function resolveThinkingConfig(input: ResolveThinkingConfigInput): ThinkingConfig {
  const { providerId, model, enabled } = input;
  const canThink = enabled && usesAnthropicWire(providerId, model) && supportsAdaptiveThinking(model);

  if (!canThink) {
    // Not requesting thinking does not mean no thinking happens: Opus 5 and
    // Fable 5 think anyway. Give them the same headroom an explicit request
    // gets, or their reasoning eats a budget sized for the answer alone.
    return { maxTokens: reasonsByDefault(model) ? THINKING_MAX_TOKENS : DEFAULT_MAX_TOKENS };
  }
  // z.ai routes through its Anthropic-compatible endpoint but GLM thinking is
  // `{type:'enabled'}`, NOT Claude 4.6+ `{type:'adaptive'}` — sending adaptive
  // is rejected by z.ai (then safely falls back to no-thinking).
  if (providerId === 'zai') return { thinking: { type: 'enabled' }, maxTokens: THINKING_MAX_TOKENS };
  return { thinking: { type: 'adaptive', display: 'summarized' }, maxTokens: THINKING_MAX_TOKENS };
}

/**
 * OpenAI model families that accept top-level `reasoning_effort` on Chat
 * Completions: gpt-5.x (including dated/aliased variants like the GPT-5.6
 * `-sol`/`-terra`/`-luna` family and its `gpt-5.6` alias) and the o-series
 * (o1/o3/o4). GPT-4-era models (gpt-4o, gpt-4o-mini, gpt-4.1) reject the
 * parameter, so they are intentionally excluded.
 */
const OPENAI_REASONING_MODEL_PATTERNS: readonly RegExp[] = [
  /^gpt-5/, // gpt-5, gpt-5-mini, gpt-5.1…gpt-5.5, gpt-5.6-sol/-terra/-luna
  /^gpt-6(?:\.\d+)?(-|$)/,
  /^o[134](-|$)/, // o1, o1-mini, o3, o3-mini, o4-mini
];

/**
 * True for `providerId`/`model` combinations that accept a `reasoning_effort`
 * parameter. `openrouter` always qualifies -- its unified `reasoning: {
 * effort }` object is normalized per upstream provider (Anthropic thinking
 * budgets, Google thinkingLevel, OpenAI effort), so per-model gating there is
 * the router's job, not this module's. `openai` qualifies only for the
 * reasoning-capable model families above; every other provider never sends
 * the parameter. Case-insensitive on model.
 */
export function supportsReasoningEffort(providerId: string, model: string): boolean {
  if (providerId === 'openrouter') return true;
  if (providerId !== 'openai') return false;

  const lower = model.toLowerCase();
  return OPENAI_REASONING_MODEL_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * OpenAI model families that REASON BY DEFAULT and refuse to combine function
 * tools with that reasoning on `/v1/chat/completions`:
 *
 *   400 invalid_request_error: Function tools with reasoning_effort are not
 *   supported for gpt-5.6-terra in /v1/chat/completions. To use function
 *   tools, use /v1/responses or set reasoning_effort to 'none'.
 *
 * The default matters more than the name of the parameter: GPT-5.6 reasons at
 * `medium` unless told otherwise, so the rejection fires on a request that
 * never mentions `reasoning_effort` at all. Gating this on "did the caller ask
 * for reasoning" would therefore miss the common case -- see
 * {@link requiresResponsesApiForTools}.
 *
 * An explicit allow-list, matching the file's other capability tables. A
 * future family with the same constraint is caught reactively instead, by the
 * runner's `isToolReasoningEndpointRejection` fallback.
 */
const RESPONSES_API_TOOL_REASONING_PATTERNS: readonly RegExp[] = [
  /^gpt-5\.6(-|$)/, // gpt-5.6 and the -sol / -terra / -luna variants
  /^gpt-6(?:\.\d+)?(-|$)/, // GPT-6 uses Responses for tool calling with reasoning.
];

/** OpenRouter-style routing prefix for OpenAI models, e.g. `openai/gpt-5.6-terra`. */
const OPENAI_ROUTE_PREFIX = 'openai/';

/**
 * Anthropic models that think unless explicitly told not to, so their thinking
 * is billed against `max_tokens` whether or not we asked for it:
 *
 *   - Opus 5 runs adaptive thinking when `thinking` is omitted (a change from
 *     Opus 4.8/4.7, where omitting it meant no thinking).
 *   - Fable 5's thinking is always on; `{type:'disabled'}` is rejected outright.
 *
 * Separate from {@link RESPONSES_API_TOOL_REASONING_PATTERNS} because the two
 * answer different questions — this one sizes the token budget, that one picks
 * an HTTP endpoint, and only OpenAI has the endpoint problem.
 */
const ANTHROPIC_ALWAYS_THINKING_PATTERNS: readonly RegExp[] = [
  /^claude-opus-5(-|$)/, // Claude Opus 5
  /^claude-fable-5(-|$)/, // Claude Fable 5
];

/** Strip whichever OpenRouter-style vendor routing prefix `model` carries. */
function stripRoutePrefix(model: string): string {
  if (model.startsWith(OPENAI_ROUTE_PREFIX)) return model.slice(OPENAI_ROUTE_PREFIX.length);
  return stripAnthropicRoutePrefix(model);
}

/**
 * True when `model` reasons unless explicitly told not to — across vendors.
 *
 * The consequence is the same everywhere and is why this is one predicate: the
 * model spends output tokens thinking on a request that never asked it to, so
 * a budget sized for answer-only output truncates the answer. Routed ids
 * (`openai/…`, `anthropic/…`) resolve the same as bare ones.
 *
 * GLM matches on every route — Hosted (Workers AI `@cf/zai-org/glm-5.3-flash`,
 * listed by Cloudflare as a Reasoning model), z.ai, and OpenRouter `z-ai/…` —
 * by the same "contains glm" rule as {@link supportsAdaptiveThinking}. Hosted
 * speaks the OpenAI wire, so it never gets a `thinking` block; without this its
 * reasoning ate the answer-sized 8192 budget and a Scout run returned zero
 * content at `max_tokens` (staging, 2026-09-14).
 */
export function reasonsByDefault(model: string): boolean {
  const lower = model.toLowerCase();
  if (lower.includes('glm')) return true;
  const bare = stripRoutePrefix(lower);
  return [...RESPONSES_API_TOOL_REASONING_PATTERNS, ...ANTHROPIC_ALWAYS_THINKING_PATTERNS].some((pattern) =>
    pattern.test(bare),
  );
}

/**
 * True when a request carrying function tools must go to `/v1/responses`
 * instead of `/v1/chat/completions` to keep the model's reasoning.
 *
 * `effort === 'none'` is the one case that stays on Chat Completions: it
 * explicitly turns the model's reasoning off, which is exactly the condition
 * OpenAI's error names as the alternative to switching endpoints. Every other
 * value -- including `undefined`, which leaves the model on its reasoning
 * default -- needs Responses.
 *
 * Callers must additionally check that tools are actually present and that the
 * base URL really is OpenAI's; this predicate answers the model question only.
 */
export function requiresResponsesApiForTools(model: string, effort?: ReasoningEffort): boolean {
  if (effort === 'none') return false;
  // Deliberately NOT `reasonsByDefault` — that spans vendors now, and an
  // Anthropic model reasoning by default has nothing to do with an OpenAI
  // endpoint constraint.
  const bare = stripRoutePrefix(model.toLowerCase());
  return RESPONSES_API_TOOL_REASONING_PATTERNS.some((pattern) => pattern.test(bare));
}

/** Input to {@link resolveReasoningConfig}. */
export interface ResolveReasoningConfigInput {
  /** LLM provider id, e.g. `'anthropic'`, `'zai'`, `'openrouter'`, `'openai'`. */
  providerId: string;
  model: string;
  /** User/org per-provider setting; undefined → never send the parameter. */
  effort?: ReasoningEffort;
}

/** Result of {@link resolveReasoningConfig} -- spread directly into the provider request body. */
export interface ReasoningConfig {
  /** Present only when the effort should actually be sent. */
  reasoningEffort?: ReasoningEffort;
  maxTokens: number;
}

/**
 * Provider/model-aware `reasoning_effort` request fragment + max_tokens. When
 * `effort` is undefined, or the provider/model can't take the parameter,
 * returns NO `reasoningEffort` and the default max_tokens (4096) -- a safe
 * no-op, mirroring `resolveThinkingConfig`'s no-op shape. `'none'` is sent
 * as-is (it explicitly disables a gpt-5.x model's default reasoning, so
 * DEFAULT_MAX_TOKENS is enough headroom); any other level shares the
 * completion token budget with reasoning output on OpenAI, so it gets the
 * same THINKING_MAX_TOKENS headroom as Anthropic-wire thinking.
 */
export function resolveReasoningConfig(input: ResolveReasoningConfigInput): ReasoningConfig {
  const { providerId, model, effort } = input;

  if (!supportsReasoningEffort(providerId, model)) return { maxTokens: DEFAULT_MAX_TOKENS };
  if (effort === undefined) {
    // No explicit setting: send nothing and let the model apply its own
    // default. A family that reasons by default still bills that reasoning
    // against the output budget, so it needs the same headroom an explicit
    // request gets -- sized for answer-only output, its answer gets truncated.
    return { maxTokens: reasonsByDefault(model) ? THINKING_MAX_TOKENS : DEFAULT_MAX_TOKENS };
  }
  if (effort === 'none') return { reasoningEffort: 'none', maxTokens: DEFAULT_MAX_TOKENS };
  return { reasoningEffort: effort, maxTokens: THINKING_MAX_TOKENS };
}

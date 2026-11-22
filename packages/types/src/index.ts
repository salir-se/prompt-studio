// ── @prompt-studio/types ──────────────────────────────────────────────────────
// Shared type shapes for Prompt Studio's LLM providers and MCP servers.

/** LLM providers Prompt Studio can call directly with a user-supplied API key. */
export type ProviderId = 'anthropic' | 'openai' | 'zai' | 'openrouter';

/** Reasoning effort levels a provider may accept. */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** How an OpenAI request authenticates. */
export type OpenAiAuthMode = 'api-key' | 'chatgpt-subscription';

/** An HTTP(S) MCP server the user registered. */
export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  /** Sent as `Authorization: Bearer <apiKey>` when present. */
  apiKey?: string;
  /** Only `bearer` (the default) is supported; `oauth` servers are refused. */
  authType?: 'bearer' | 'oauth';
  headers?: Record<string, string>;
  enabled: boolean;
  /** Connect without a CORS proxy. Prompt Studio's server always connects directly. */
  directConnect?: boolean;
}

export type { CriticRubric } from './schemas/critic-scoring';

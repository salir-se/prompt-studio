// ── @prompt-studio/agent ───────────────────────────────────────────────────────
// LLM provider registry, one-shot calls, the tool-calling run loop, and the MCP HTTP client used by
// Prompt Studio's Run, Evaluations, and AI review features.

export type {
  AgentRunOptions,
  AgentRunResult,
  AgentRunStatus,
  ModelRequestOptions,
  OneShotOptions,
  OneShotReply,
  ToolDispatcher,
} from './tool-loop';
export { OneShotTruncatedError, runAgent, runOneShot, TOOL_RESULT_MAX_BYTES } from './tool-loop';
export type {
  LlmChatRequest,
  LlmChatResponse,
  LlmProvider,
  LlmProviderConfig,
  LlmStreamCallbacks,
  LlmTestResult,
} from './provider';
export { createProvider, detectProvider, listProviders, registerProvider } from './provider';
export { createAnthropicProvider } from './providers/anthropic';
export { registerBuiltinProviders } from './providers/index';
export { createOpenAICompatProvider } from './providers/openai-compat';

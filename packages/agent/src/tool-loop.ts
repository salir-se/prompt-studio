import type { ToolDefinition } from '@prompt-studio/prompts';
import { PromptRequestMessagesSchema } from '@prompt-studio/prompts';
import type { LlmChatResponse, LlmProvider } from './provider';
import type { ContentBlock } from './types';

/**
 * A provider-neutral model loop for Prompt Studio.
 *
 * `runOneShot` sends one request and returns its text. `runAgent` lets the model call tools: every
 * `tool_use` block goes to `dispatchTool`, and its JSON result returns as a `tool_result` block, until
 * the model stops asking for tools or a limit is reached. Neither function stores anything; the caller
 * owns persistence, tracing and cost reporting.
 */

/** The largest tool result, in bytes, that is sent back to the model. Longer results are cut. */
export const TOOL_RESULT_MAX_BYTES = 32 * 1024;

export interface ModelRequestOptions {
  readonly model: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface OneShotOptions {
  readonly provider: LlmProvider;
  readonly systemPrompt: string;
  /** The user turn. Ignored when `initialMessages` is given. */
  readonly userMessage: string;
  /** A prior conversation (`user`/`assistant` turns) that replaces `userMessage`. */
  readonly initialMessages?: readonly { role: string; content: string }[];
  readonly request: ModelRequestOptions;
  readonly signal?: AbortSignal;
  /** Informational labels kept for log correlation by callers. */
  readonly agentName?: string;
  readonly runId?: string;
}

export interface OneShotReply {
  readonly runId: string;
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type ToolDispatcher = (
  toolName: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<Record<string, unknown> | unknown[]>;

export interface AgentRunOptions extends OneShotOptions {
  readonly tools: readonly ToolDefinition[];
  readonly dispatchTool: ToolDispatcher;
  /** Maximum model requests in one run. Default 8. */
  readonly maxIterations?: number;
  /** Maximum input + output tokens across the run. Default unlimited. */
  readonly tokenBudget?: number;
}

export type AgentRunStatus = 'completed' | 'iteration_limit' | 'token_budget' | 'aborted';

export interface AgentRunResult {
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly result: string | null;
  readonly iterations: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** The model stopped at `maxTokens`; `partialText` holds what it wrote before the cut. */
export class OneShotTruncatedError extends Error {
  override readonly name = 'OneShotTruncatedError';

  constructor(
    message: string,
    readonly partialText: string,
    readonly outputTokens: number,
  ) {
    super(message);
  }
}

type ConversationMessage = { role: 'user' | 'assistant'; content: string | ContentBlock[] | ToolResultBlock[] };
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

const TRUNCATED_STOP_REASONS = new Set(['max_tokens', 'length']);

function firstMessages(options: OneShotOptions): ConversationMessage[] {
  if (options.initialMessages === undefined) return [{ role: 'user', content: options.userMessage }];
  return PromptRequestMessagesSchema.assert(options.initialMessages).map(({ role, content }) => ({
    role: role === 'assistant' ? 'assistant' : 'user',
    content,
  }));
}

function textOf(response: LlmChatResponse): string {
  return response.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function capResult(json: string): string {
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength <= TOOL_RESULT_MAX_BYTES) return json;
  const cut = new TextDecoder().decode(bytes.slice(0, TOOL_RESULT_MAX_BYTES));
  return `${cut}\n[truncated: the tool result exceeded ${TOOL_RESULT_MAX_BYTES} bytes]`;
}

function chat(options: OneShotOptions, messages: ConversationMessage[], tools: readonly ToolDefinition[]) {
  return options.provider.chat({
    model: options.request.model,
    systemPrompt: options.systemPrompt,
    messages,
    tools: [...tools],
    maxTokens: options.request.maxTokens,
    temperature: options.request.temperature,
    signal: options.signal,
  });
}

/** Sends one request without tools and returns the reply text. Throws `OneShotTruncatedError` on a cut reply. */
export async function runOneShot(options: OneShotOptions): Promise<OneShotReply> {
  options.signal?.throwIfAborted();
  const response = await chat(options, firstMessages(options), []);
  const text = textOf(response);
  if (TRUNCATED_STOP_REASONS.has(response.stopReason)) {
    throw new OneShotTruncatedError('Model response was truncated at max_tokens', text, response.usage.outputTokens);
  }
  return {
    runId: options.runId ?? crypto.randomUUID(),
    text,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  };
}

/** Runs the model with tools until it answers without a tool call or a limit is reached. */
export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const runId = options.runId ?? crypto.randomUUID();
  const maxIterations = options.maxIterations ?? 8;
  const messages = firstMessages(options);
  let inputTokens = 0;
  let outputTokens = 0;
  let iterations = 0;
  const finish = (status: AgentRunStatus, result: string | null): AgentRunResult => ({
    runId,
    status,
    result,
    iterations,
    inputTokens,
    outputTokens,
  });

  while (iterations < maxIterations) {
    if (options.signal?.aborted) return finish('aborted', null);
    iterations += 1;
    const response = await chat(options, messages, options.tools);
    inputTokens += response.usage.inputTokens;
    outputTokens += response.usage.outputTokens;
    const toolUses = response.content.filter((block) => block.type === 'tool_use' && block.id && block.name);
    if (toolUses.length === 0) {
      if (TRUNCATED_STOP_REASONS.has(response.stopReason)) {
        throw new OneShotTruncatedError('Model response was truncated at max_tokens', textOf(response), outputTokens);
      }
      return finish('completed', textOf(response));
    }
    if (options.tokenBudget !== undefined && inputTokens + outputTokens >= options.tokenBudget) {
      return finish('token_budget', null);
    }
    messages.push({ role: 'assistant', content: response.content });
    const results: ToolResultBlock[] = [];
    for (const block of toolUses) {
      if (options.signal?.aborted) return finish('aborted', null);
      try {
        const output = await options.dispatchTool(block.name!, block.input ?? {}, options.signal);
        results.push({ type: 'tool_result', tool_use_id: block.id!, content: capResult(JSON.stringify(output)) });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tool execution failed.';
        results.push({
          type: 'tool_result',
          tool_use_id: block.id!,
          content: JSON.stringify({ error: `Tool '${block.name}' failed: ${message}` }),
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return finish('iteration_limit', null);
}

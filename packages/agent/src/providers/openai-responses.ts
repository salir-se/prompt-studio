/**
 * OpenAI Responses API (`POST /v1/responses`) wire translation.
 *
 * WHY this exists at all: the GPT-5.6 family (`-sol`/`-terra`/`-luna`) rejects
 * function tools combined with any reasoning other than `'none'` on
 * `/v1/chat/completions` —
 *
 *   400 invalid_request_error: Function tools with reasoning_effort are not
 *   supported for gpt-5.6-terra in /v1/chat/completions. To use function tools,
 *   use /v1/responses or set reasoning_effort to 'none'.
 *
 * — and those models reason at `medium` BY DEFAULT, so the rejection fires even
 * when we never send `reasoning_effort` at all. Every agent run carries tools,
 * so on Chat Completions the only way to keep tool calling is to disable the
 * model's reasoning entirely. Responses is the endpoint where both work
 * together, which is why this module exists rather than a clamp to `'none'`.
 *
 * Pure translation: no I/O, no network, no retry/error policy. The transport
 * (auth, timeouts, transient retry, overload guard, error mapping) stays in
 * `./openai-compat.ts`, which picks the endpoint per request and calls in here
 * for the body/response shape. Keeping it split means the Responses path
 * inherits every transport guarantee the Chat Completions path already has.
 *
 * ── Format notes that are easy to get wrong ──────────────────────────────
 *
 * - A tool call carries TWO ids: the item id (`fc_…`) and the call id
 *   (`call_…`). Only `call_id` pairs a call with its `function_call_output`,
 *   so `call_id` — never `id` — is what we map onto our internal
 *   `tool_use.id`. Round-tripping the wrong one 400s the next turn.
 * - Tools are FLAT here (`{type,name,description,parameters}`), not nested
 *   under a `function` key the way Chat Completions nests them.
 * - An input message with `role: 'assistant'` may not use `input_text` content
 *   parts; assistant text is `output_text`.
 * - The system prompt is `instructions`, not a leading message.
 * - Reasoning items returned by the model are deliberately NOT replayed into
 *   the next turn's input: doing so requires their server-assigned ids (and
 *   encrypted payloads) to be echoed exactly, and a mismatch is a hard 400.
 *   Dropping them costs some cross-turn reasoning continuity and nothing else.
 */

import type { ToolDefinition } from '@prompt-studio/prompts';
import type { ReasoningEffort } from '@prompt-studio/types';
import { openaiCachedInputTokens, withOpenAiCacheUsage } from '../openai-cached-tokens';
import type { LlmChatResponse } from '../provider';
import { StreamedToolCalls } from '../streamed-tool-calls';
import type { ContentBlock } from '../types';
import { type NativeToolDropContext, partitionNativeTools } from './native-tool-drop';

/** Options that the calling adapter resolves before building a request body. */
export interface ResponsesBodyOptions {
  model: string;
  systemPrompt: string;
  messages: unknown[];
  tools: ToolDefinition[];
  maxTokens: number;
  /** Omitted, or `'none'`, sends no `reasoning` object at all. */
  reasoningEffort?: ReasoningEffort;
  stream?: boolean;
  /** Omitted preserves the public Responses API default. */
  store?: boolean;
  /** Where a native-only tool's drop is recorded (`./native-tool-drop.ts`); omitted keeps the translation silent. */
  nativeToolDrop?: NativeToolDropContext;
}

// ── Request translation ──────────────────────────────────────────────────

/**
 * Convert our Anthropic-style tool definitions to Responses function tools.
 * Mirrors `toOpenAITools`' split — a `WebSearchTool` carries no `description`
 * and is a server-side tool, not a function the runner can dispatch; its drop
 * is recorded through `drop` (`./native-tool-drop.ts`), never silent.
 */
export function toResponsesTools(tools: ToolDefinition[], drop?: NativeToolDropContext): unknown[] {
  return partitionNativeTools(tools, drop).functionTools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  }));
}

function isToolResult(value: unknown): value is { type: 'tool_result'; tool_use_id: string; content: unknown } {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'tool_result';
}

/** Flatten mixed content down to a plain string, matching the Chat Completions adapter. */
function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object' && 'text' in c) return (c as { text: string }).text;
        return JSON.stringify(c);
      })
      .join('');
  }
  return JSON.stringify(content);
}

/**
 * Convert our message array to Responses `input` items.
 *
 * Ordering is load-bearing: a `function_call` must appear before the
 * `function_call_output` that answers it. Our array already holds the
 * assistant turn ahead of the user turn carrying its tool results, so a
 * straight in-order walk preserves that.
 */
export function toResponsesInput(messages: unknown[]): unknown[] {
  const input: unknown[] = [];

  for (const msg of messages as Array<{ role: string; content: unknown; tool_use_id?: string }>) {
    if (msg.role === 'user') {
      if (Array.isArray(msg.content) && msg.content.some(isToolResult)) {
        const nonToolContent = msg.content.filter((block) => !isToolResult(block));
        for (const block of msg.content.filter(isToolResult)) {
          input.push({
            type: 'function_call_output',
            call_id: block.tool_use_id,
            output: stringifyContent(block.content),
          });
        }
        // Any prose alongside the results follows them, so the model reads the
        // tool output first and the human's remark as the newer turn.
        if (nonToolContent.length > 0) {
          input.push({ role: 'user', content: stringifyContent(nonToolContent) });
        }
        continue;
      }
      input.push({ role: 'user', content: stringifyContent(msg.content) });
      continue;
    }

    if (msg.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        const blocks = msg.content as ContentBlock[];
        const text = blocks
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('');
        // `input_text` is rejected for role `assistant`; `output_text` is the
        // content part an assistant message is allowed to carry.
        if (text) input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
        for (const block of blocks.filter((b) => b.type === 'tool_use')) {
          input.push({
            type: 'function_call',
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          });
        }
        continue;
      }
      const text = stringifyContent(msg.content);
      if (text) input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      continue;
    }

    if (msg.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: msg.tool_use_id ?? '',
        output: stringifyContent(msg.content),
      });
    }
  }

  return input;
}

/** Build a complete `POST /v1/responses` request body. */
export function buildResponsesBody(options: ResponsesBodyOptions): Record<string, unknown> {
  const { model, systemPrompt, messages, tools, maxTokens, reasoningEffort, stream, store, nativeToolDrop } = options;

  const body: Record<string, unknown> = {
    model,
    instructions: systemPrompt,
    input: toResponsesInput(messages),
    max_output_tokens: maxTokens,
  };

  const functionTools = toResponsesTools(tools, nativeToolDrop);
  if (functionTools.length > 0) body.tools = functionTools;

  // `'none'` is the Chat Completions escape hatch, not a Responses request
  // shape — on this endpoint "no reasoning object" is how you ask for the
  // model's own default, and sending `{effort:'none'}` would needlessly
  // suppress the reasoning this endpoint was chosen to preserve.
  if (reasoningEffort && reasoningEffort !== 'none') {
    body.reasoning = { effort: reasoningEffort };
  }

  if (stream) body.stream = true;
  if (store !== undefined) body.store = store;

  return body;
}

// ── Response translation ─────────────────────────────────────────────────

/** Pull the assistant text out of a `message` output item's content parts. */
function messageItemText(item: Record<string, unknown>): string {
  const parts = (item.content as Array<Record<string, unknown>>) || [];
  return parts
    .filter((p) => p.type === 'output_text')
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('');
}

/** Pull the reasoning summary text out of a `reasoning` output item. */
function reasoningItemText(item: Record<string, unknown>): string {
  const summary = (item.summary as Array<Record<string, unknown>>) || [];
  return summary
    .map((s) => (typeof s.text === 'string' ? s.text : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * Map a Responses `status`/`incomplete_details` pair plus the presence of tool
 * calls onto the `stop_reason` vocabulary the runner branches on: `'tool_use'`
 * keeps the loop going, `'max_tokens'` triggers the truncation path, and
 * `'end_turn'` ends the run.
 */
function toStopReason(data: Record<string, unknown>, hasToolCalls: boolean): string {
  if (hasToolCalls) return 'tool_use';
  const incomplete = data.incomplete_details as { reason?: string } | undefined;
  if (data.status === 'incomplete') {
    return incomplete?.reason === 'max_output_tokens' || incomplete?.reason === 'max_tokens'
      ? 'max_tokens'
      : 'end_turn';
  }
  return 'end_turn';
}

/** Convert a non-streaming Responses payload to our internal shape. */
export function fromResponsesResponse(data: Record<string, unknown>): LlmChatResponse {
  const output = (data.output as Array<Record<string, unknown>>) || [];
  const usage = (data.usage as Record<string, unknown>) || {};
  const content: ContentBlock[] = [];
  let hasToolCalls = false;

  for (const item of output) {
    if (item.type === 'reasoning') {
      const thinking = reasoningItemText(item);
      if (thinking) content.push({ type: 'thinking', thinking });
      continue;
    }
    if (item.type === 'message') {
      const text = messageItemText(item);
      if (text) content.push({ type: 'text', text });
      continue;
    }
    if (item.type === 'function_call') {
      hasToolCalls = true;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse((item.arguments as string) || '{}');
      } catch {
        // Leave `input` empty — the dispatcher's own guards report a tool call
        // it cannot satisfy far more usefully than a thrown parse error here.
      }
      content.push({
        type: 'tool_use',
        // `call_id` — not `id` — is what pairs with `function_call_output`.
        id: (item.call_id as string) || (item.id as string),
        name: item.name as string,
        input,
      });
    }
  }

  return {
    content,
    usage: withOpenAiCacheUsage(
      {
        inputTokens: (usage.input_tokens as number) || 0,
        outputTokens: (usage.output_tokens as number) || 0,
      },
      usage,
    ),
    stopReason: toStopReason(data, hasToolCalls),
    model: data.model as string | undefined,
    raw: data,
  };
}

// ── Streaming ────────────────────────────────────────────────────────────

/** Callbacks the stream accumulator reports progress through. */
export interface ResponsesStreamHandlers {
  onToken?(text: string): void;
  onThinking?(text: string): void;
  onToolCallStart?(name: string, id: string): void;
  onToolCallDelta?(id: string, delta: string): void;
  onUsage?(inputTokens: number, outputTokens: number): void;
  onStop?(reason: string): void;
}

/**
 * Accumulates the Responses SSE event stream into one `LlmChatResponse`.
 *
 * Tool calls are keyed by `output_index` — the wire's own stable identity for
 * an output item — so two calls to the same tool in one turn keep separate
 * argument buffers however their fragments interleave. That's the same
 * invariant `StreamedToolCalls` exists to hold for the Chat Completions
 * stream, reused here rather than re-derived.
 *
 * Usage is read ONLY from the terminal `response.completed`/`response.incomplete`
 * event; the intermediate envelope events carry a partial `response` object
 * whose token counts are not final.
 */
export class ResponsesStreamAccumulator {
  private readonly content: ContentBlock[] = [];
  private readonly toolCalls = new StreamedToolCalls();
  private readonly thinkingByIndex = new Map<number, ContentBlock>();
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadInputTokens: number | undefined;
  private stopReason = 'end_turn';
  private sawToolCall = false;
  private failure: string | undefined;
  private terminalResponse: Record<string, unknown> | undefined;

  constructor(private readonly handlers: ResponsesStreamHandlers = {}) {}

  /** Feed one parsed SSE `data:` payload. */
  handleEvent(event: Record<string, unknown>): void {
    const type = event.type as string;

    switch (type) {
      case 'response.output_text.delta': {
        const delta = (event.delta as string) || '';
        if (!delta) return;
        const last = this.content[this.content.length - 1];
        if (last && last.type === 'text') {
          last.text = (last.text || '') + delta;
        } else {
          this.content.push({ type: 'text', text: delta });
        }
        this.handlers.onToken?.(delta);
        return;
      }

      case 'response.reasoning_summary_text.delta': {
        const delta = (event.delta as string) || '';
        if (!delta) return;
        // Keyed by output_index so two reasoning items never merge into one
        // block, and so a later text block can't swallow the reasoning tail.
        const index = typeof event.output_index === 'number' ? event.output_index : -1;
        let block = this.thinkingByIndex.get(index);
        if (!block) {
          block = { type: 'thinking', thinking: '' };
          this.thinkingByIndex.set(index, block);
          this.content.push(block);
        }
        block.thinking = (block.thinking || '') + delta;
        this.handlers.onThinking?.(delta);
        return;
      }

      case 'response.output_item.added': {
        const item = (event.item as Record<string, unknown>) || {};
        if (item.type !== 'function_call') return;
        this.sawToolCall = true;
        const key = typeof event.output_index === 'number' ? event.output_index : this.content.length;
        const { block, isNew } = this.toolCalls.open(key, item.call_id as string, item.name as string);
        if (isNew) {
          this.content.push(block);
          this.handlers.onToolCallStart?.((item.name as string) || '', block.id ?? '');
        }
        return;
      }

      case 'response.function_call_arguments.delta': {
        const delta = (event.delta as string) || '';
        if (!delta) return;
        const key = typeof event.output_index === 'number' ? event.output_index : undefined;
        this.toolCalls.append(key, delta);
        this.handlers.onToolCallDelta?.(this.toolCalls.idFor(key) || '', delta);
        return;
      }

      case 'response.completed':
      case 'response.incomplete': {
        const response = (event.response as Record<string, unknown>) || {};
        this.terminalResponse = { ...response, status: type === 'response.completed' ? 'completed' : 'incomplete' };
        const usage = (response.usage as Record<string, unknown>) || {};
        this.inputTokens = (usage.input_tokens as number) || 0;
        this.outputTokens = (usage.output_tokens as number) || 0;
        this.cacheReadInputTokens = openaiCachedInputTokens(usage);
        this.handlers.onUsage?.(this.inputTokens, this.outputTokens);
        this.stopReason = toStopReason(
          { status: type === 'response.incomplete' ? 'incomplete' : 'completed', ...response },
          this.sawToolCall,
        );
        this.handlers.onStop?.(this.stopReason);
        return;
      }

      case 'response.failed': {
        const response = (event.response as Record<string, unknown>) || {};
        const error = (response.error as { message?: string }) || {};
        this.failure = error.message || 'Responses API reported a failed response';
        return;
      }

      case 'error': {
        const message = (event.message as string) || undefined;
        this.failure = message || 'Responses API stream reported an error';
        return;
      }

      default:
        // Envelope and lifecycle events we intentionally ignore
        // (`response.created`, `.in_progress`, `.output_item.done`,
        // `.content_part.*`, `.output_text.done`, …). Ignoring unknown event
        // types is what lets OpenAI add new ones without breaking this parser.
        return;
    }
  }

  /** The terminal error reported by the stream, if any. */
  get streamError(): string | undefined {
    return this.failure;
  }

  /** Finish argument parsing and produce the response. */
  finalize(onParseError?: (block: ContentBlock) => void): LlmChatResponse {
    this.toolCalls.finalize(onParseError);
    return {
      content: this.content,
      ...(this.terminalResponse && {
        model: typeof this.terminalResponse.model === 'string' ? this.terminalResponse.model : undefined,
        raw: this.terminalResponse,
      }),
      usage:
        this.cacheReadInputTokens === undefined
          ? { inputTokens: this.inputTokens, outputTokens: this.outputTokens }
          : {
              inputTokens: this.inputTokens,
              outputTokens: this.outputTokens,
              cacheReadInputTokens: this.cacheReadInputTokens,
            },
      stopReason: this.stopReason,
    };
  }
}

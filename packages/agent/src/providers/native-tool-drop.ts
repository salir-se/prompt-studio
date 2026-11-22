/**
 * A native-only tool (Anthropic's server-side `web_search`, declared as `{ name, type }` with no `description`) has no
 * OpenAI-wire counterpart: an OpenAI-compatible adapter cannot send it as a function. Until 2026-10-11 the adapters
 * dropped it silently, so a Hosted or z.ai Scout ran with no search tool and nothing said so (ADR-280 amendment
 * 2026-10-10, Train 5). The drop stays — the wire has no shape for it — but it is now a recorded decision: one `warn`
 * line per request and per dropped tool, with the tool and the provider, so a run log and Axiom both show it.
 */
import type { WarnLogger } from '@prompt-studio/observability';
import type { CustomTool, ToolDefinition } from '@prompt-studio/prompts';

/** The warn line's message; `{ toolName, provider }` are its fields. */
export const NATIVE_TOOL_DROPPED_MESSAGE = 'native tool dropped by provider adapter';

export interface NativeToolDropContext {
  /** The adapter's provider id (`hosted`, `zai`, `openrouter`, …), as its other lines name it. */
  provider: string;
  log: WarnLogger;
}

/**
 * Splits a request's tools into the function tools an OpenAI-wire adapter can send and the native-only tools it
 * cannot, warning once for each dropped tool. Without a context the split is silent (pure translation).
 */
export function partitionNativeTools(
  tools: ToolDefinition[],
  context?: NativeToolDropContext,
): { functionTools: CustomTool[]; dropped: string[] } {
  const functionTools: CustomTool[] = [];
  const dropped: string[] = [];
  for (const tool of tools) {
    if ('description' in tool) functionTools.push(tool as CustomTool);
    else dropped.push(tool.name);
  }
  if (context) {
    for (const toolName of dropped) {
      context.log.warn({ toolName, provider: context.provider }, NATIVE_TOOL_DROPPED_MESSAGE);
    }
  }
  return { functionTools, dropped };
}

import { bundledPromptContentSource, type PromptContentSource } from './prompt-content-source';

/**
 * Built-in (non-MCP) tool directory for the prompt studio's "Tools" drawer.
 *
 * Unions every `*_TOOLS` array the content source exposes (defaulting to `bundledPromptContentSource`,
 * which mirrors every `*_TOOLS` array `@prompt-studio/prompts` ships), deduping a tool that appears in more
 * than one agent's list (e.g. `web_search` in both Scout and Researcher, or the scheduler tools
 * spread into every agent) and recording which agent(s) — "sources" — declare it. `ToolDefinition` is
 * a union (`WebSearchTool` has no `description`/`input_schema`; `CustomTool` has both), so both are
 * narrowed defensively rather than assumed.
 *
 * This module never imports a `*_TOOLS` array directly — see `./prompt-content-source.ts` for why
 * that import boundary matters (tool descriptions are prose IP, same as the prompt text).
 */

export interface ToolDirectoryEntry {
  readonly name: string;
  readonly description: string | undefined;
  readonly inputKeys: readonly string[];
  readonly sources: readonly string[];
}

interface MutableEntry {
  description: string | undefined;
  inputKeys: readonly string[];
  sources: Set<string>;
}

/**
 * Union of every built-in tool definition, deduped by `name` and sorted for a stable, deterministic
 * render — two calls always produce the same array (no `Date`/`Math.random`/iteration-order surprises).
 * `contentSource` defaults to `bundledPromptContentSource` so every existing caller keeps working
 * unchanged; a later task swaps in a runtime implementation that reads tool descriptions from a
 * mounted repository instead.
 */
export function buildToolDirectory(
  contentSource: PromptContentSource = bundledPromptContentSource,
): readonly ToolDirectoryEntry[] {
  const byName = new Map<string, MutableEntry>();

  for (const { source, tools } of contentSource.getToolSourceLists()) {
    for (const tool of tools) {
      const existing = byName.get(tool.name);
      if (existing) {
        existing.sources.add(source);
        continue;
      }
      byName.set(tool.name, {
        description: tool.description,
        inputKeys: tool.inputKeys,
        sources: new Set([source]),
      });
    }
  }

  return [...byName.entries()]
    .map(([name, entry]): ToolDirectoryEntry => ({
      name,
      description: entry.description,
      inputKeys: entry.inputKeys,
      sources: [...entry.sources].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

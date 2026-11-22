// @module-tag pure
import { createMockLogger } from '@prompt-studio/observability/test';
import type { ToolDefinition } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import { NATIVE_TOOL_DROPPED_MESSAGE, partitionNativeTools } from './native-tool-drop';
import { toResponsesTools } from './openai-responses';

const saveLead = { name: 'save_lead', description: 'Save a lead', input_schema: { type: 'object', properties: {} } };
const webSearch = { name: 'web_search', type: 'web_search_20250305' };
const tools = (...list: unknown[]) => list as ToolDefinition[];

describe('partitionNativeTools', () => {
  describe('warn logging', () => {
    it('warns once per request for the native tool it cannot send, naming the tool and the provider', () => {
      // Given: a Scout request with the native web_search beside a function tool, on the Hosted adapter
      const { logger, entries } = createMockLogger('llm:openai-compat');
      // When: the adapter splits the tools for the wire
      const { functionTools, dropped } = partitionNativeTools(tools(webSearch, saveLead), {
        provider: 'hosted',
        log: logger,
      });
      // Then: the function tool is sent, the native one is dropped and the drop is one warn line with its fields
      expect(functionTools.map((tool) => tool.name)).toEqual(['save_lead']);
      expect(dropped).toEqual(['web_search']);
      const warns = entries.filter((entry) => entry.level === 'warn');
      expect(warns).toHaveLength(1);
      expect(warns[0]?.msg).toBe(NATIVE_TOOL_DROPPED_MESSAGE);
      expect(warns[0]?.obj).toEqual({ toolName: 'web_search', provider: 'hosted' });
    });

    it('does not warn when every tool is a function the wire can carry', () => {
      // Given: only function tools
      const { logger, entries } = createMockLogger('llm:openai-compat');
      // When
      const { functionTools, dropped } = partitionNativeTools(tools(saveLead), { provider: 'hosted', log: logger });
      // Then: nothing dropped, no warn line
      expect(functionTools).toHaveLength(1);
      expect(dropped).toEqual([]);
      expect(entries.filter((entry) => entry.level === 'warn')).toEqual([]);
    });

    it('stays silent without a context, as a pure translation', () => {
      // Given / When: no logger is offered
      const { functionTools, dropped } = partitionNativeTools(tools(webSearch, saveLead));
      // Then: the split still happens, nothing throws
      expect(functionTools).toHaveLength(1);
      expect(dropped).toEqual(['web_search']);
    });
  });
});

describe('toResponsesTools', () => {
  it('records the drop of a native tool through the same context', () => {
    // Given: the Responses translation with a drop context
    const { logger, entries } = createMockLogger('llm:openai-compat');
    // When
    const sent = toResponsesTools(tools(webSearch, saveLead), { provider: 'openai', log: logger });
    // Then: one function tool on the wire, one warn line for the drop
    expect(sent).toHaveLength(1);
    expect(entries).toEqual([
      { level: 'warn', msg: NATIVE_TOOL_DROPPED_MESSAGE, obj: { toolName: 'web_search', provider: 'openai' } },
    ]);
  });
});

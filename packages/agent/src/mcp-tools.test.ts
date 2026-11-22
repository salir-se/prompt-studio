// @module-tag pure
import { describe, expect, it } from 'vitest';
import type { McpTool } from './mcp-types';
import { mcpToolsToDefinitions, validateMcpToolInput } from './mcp-tools';

describe('mcpToolsToDefinitions', () => {
  it('converts MCP tools to CustomTool format', () => {
    const mcpTools: McpTool[] = [
      {
        serverId: 'server-1',
        name: 'custom_search',
        description: 'Search custom database',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ];

    const result = mcpToolsToDefinitions(mcpTools);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'custom_search',
      description: 'Search custom database',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    });
  });

  it('filters out built-in tool names', () => {
    const builtinNames = [
      'web_search',
      'check_exists',
      'save_lead',
      'guess_email',
      'verify_email',
      'save_contact',
      'save_company_brief',
      'draft_email',
      'get_conversation',
      'get_lead_context',
      'get_catalog',
      'update_status',
      'update_stage',
      'stop_outreach',
      'publish_order',
      'save_discovery_data',
      // ADR-281 Learning tools
      'recall_learnings',
      'record_learning',
      'rate_learning',
    ];

    const mcpTools: McpTool[] = builtinNames.map((name) => ({
      serverId: 'server-1',
      name,
      description: `Built-in ${name}`,
      inputSchema: { type: 'object', properties: {} },
    }));

    const result = mcpToolsToDefinitions(mcpTools);
    expect(result).toHaveLength(0);
  });

  it('keeps non-built-in tools while filtering built-in ones', () => {
    const mcpTools: McpTool[] = [
      {
        serverId: 'server-1',
        name: 'web_search', // built-in — should be filtered
        description: 'Search the web',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        serverId: 'server-1',
        name: 'exa_search', // custom — should remain
        description: 'Search with Exa',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
      {
        serverId: 'server-2',
        name: 'save_lead', // built-in — should be filtered
        description: 'Save a lead',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const result = mcpToolsToDefinitions(mcpTools);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('exa_search');
  });

  it('filters email write/send MCP tools from agent tool definitions', () => {
    const mcpTools: McpTool[] = [
      {
        serverId: 'email',
        name: 'email_send_message',
        description: 'Send an email',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        serverId: 'email',
        name: 'email_create_draft',
        description: 'Create a draft',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        serverId: 'email',
        name: 'email_send_draft',
        description: 'Send a draft',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        serverId: 'email',
        name: 'email_create_label',
        description: 'Create a label',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        serverId: 'email',
        name: 'email_modify_message',
        description: 'Modify labels',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        serverId: 'email',
        name: 'email_list_messages',
        description: 'Read messages',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const result = mcpToolsToDefinitions(mcpTools);
    expect(result.map((tool) => tool.name)).toEqual(['email_list_messages']);
  });

  it('uses fallback description when description is missing', () => {
    const mcpTools: McpTool[] = [
      {
        serverId: 'server-1',
        name: 'my_tool',
        description: undefined,
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const result = mcpToolsToDefinitions(mcpTools);
    expect(result[0].description).toBe('MCP tool: my_tool');
  });

  it('preserves description when present', () => {
    const mcpTools: McpTool[] = [
      {
        serverId: 'server-1',
        name: 'my_tool',
        description: 'A custom tool description',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const result = mcpToolsToDefinitions(mcpTools);
    expect(result[0].description).toBe('A custom tool description');
  });

  it('returns empty array for empty input', () => {
    const result = mcpToolsToDefinitions([]);
    expect(result).toEqual([]);
  });

  it('converts multiple tools from different servers', () => {
    const mcpTools: McpTool[] = [
      {
        serverId: 'server-1',
        name: 'tool_a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      },
      {
        serverId: 'server-2',
        name: 'tool_b',
        description: 'Tool B',
        inputSchema: { type: 'object', properties: { y: { type: 'string' } } },
      },
    ];

    const result = mcpToolsToDefinitions(mcpTools);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('tool_a');
    expect(result[1].name).toBe('tool_b');
  });

  it('maps inputSchema to input_schema (snake_case)', () => {
    const mcpTools: McpTool[] = [
      {
        serverId: 's1',
        name: 'test_tool',
        description: 'Test',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' },
          },
          required: ['query'],
        },
      },
    ];

    const result = mcpToolsToDefinitions(mcpTools);
    expect(result[0].input_schema).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    });
  });
});

it('validates live and mock arguments with the same MCP JSON schema', () => {
  const schema = {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
    additionalProperties: false,
  };
  expect(() => validateMcpToolInput(schema, { query: 'Example' })).not.toThrow();
  for (const input of [{ query: 42 }, {}, { query: 'Example', unexpected: true }])
    expect(() => validateMcpToolInput(schema, input)).toThrow('Invalid tool input');
});

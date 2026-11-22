import type { StudioMcpServer, ToolBinding, ToolCallTrace } from './contracts';
export const MCP_SERVER: StudioMcpServer = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Research tools',
  url: 'https://research.example.test/mcp',
  credentialAvailable: true,
  tools: [
    {
      name: 'lookup_company',
      description: 'Look up a company and return its verified public profile.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      schemaHash: 'a'.repeat(64),
      canCall: true,
    },
  ],
};
export const MCP_BINDING: ToolBinding = {
  name: 'lookup_company',
  serverId: MCP_SERVER.id,
  toolName: 'lookup_company',
  schemaHash: MCP_SERVER.tools[0].schemaHash,
  mode: 'mock',
  mock: '{\n  "company": "Acme Research",\n  "website": "https://example.test",\n  "verified": true\n}',
};
export const MCP_TRACE: ToolCallTrace = {
  id: 'captured-call',
  name: 'lookup_company',
  serverId: MCP_SERVER.id,
  toolName: 'lookup_company',
  mode: 'mock',
  input: { query: 'Acme' },
  startedAt: '2026-10-25T10:00:00Z',
  finishedAt: '2026-10-25T10:00:00.250Z',
  result: { company: 'Acme Research', verified: true },
};

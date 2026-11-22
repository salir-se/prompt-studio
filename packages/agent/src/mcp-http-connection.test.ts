// @module-tag pure
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  pages: [] as Array<{ tools: unknown[]; nextCursor?: string }>,
  reply: {} as Record<string, unknown>,
  headers: undefined as HeadersInit | undefined,
  close: vi.fn(),
  list: vi.fn(),
  call: vi.fn(),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = vi.fn(async () => {});
    close = state.close;
    listTools = state.list;
    callTool = state.call;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(_url: URL, options: { requestInit?: RequestInit }) {
      state.headers = options.requestInit?.headers;
    }
  },
}));

import { McpHttpConnection } from './mcp-http-connection';

const server = {
  id: 'fixture',
  name: 'Fixture',
  url: 'https://mcp.example.test/mcp',
  apiKey: 'private-bearer',
  enabled: true,
};
const tool = { name: 'lookup', inputSchema: { type: 'object', properties: {} } };
beforeEach(() => {
  vi.clearAllMocks();
  state.pages = [];
  state.list.mockImplementation(async () => state.pages.shift());
  state.call.mockImplementation(async () => state.reply);
});
it('discovers every bounded page and keeps the bearer in transport headers', async () => {
  state.pages = [{ tools: [tool], nextCursor: 'next' }, { tools: [{ ...tool, name: 'second' }] }];
  const client = new McpHttpConnection();
  expect((await client.connect(server)).map((tool) => tool.name)).toEqual(['lookup', 'second']);
  expect(state.list.mock.calls[1][0]).toEqual({ cursor: 'next' });
  expect(new Headers(state.headers).get('Authorization')).toBe('Bearer private-bearer');
  await client.disconnectAll();
  expect(state.close).toHaveBeenCalledOnce();
});
it('rejects repeated cursors rather than presenting an incomplete tool catalog', async () => {
  state.pages = [
    { tools: [tool], nextCursor: 'same' },
    { tools: [{ ...tool, name: 'second' }], nextCursor: 'same' },
  ];
  await expect(new McpHttpConnection().connect(server)).rejects.toThrow(/repeated.*cursor/i);
  expect(state.close).toHaveBeenCalled();
});
it('retains structured results, MCP errors and multi-block content while passing cancellation to the SDK', async () => {
  state.pages = [{ tools: [tool] }];
  const client = new McpHttpConnection();
  await client.connect(server);
  const signal = new AbortController().signal;
  state.reply = { content: [{ type: 'text', text: 'human-readable' }], structuredContent: { company: 'Example' } };
  expect(await client.callTool('lookup', {}, signal)).toEqual({ company: 'Example' });
  state.reply = { isError: true, content: [{ type: 'text', text: 'Unavailable' }] };
  expect(await client.callTool('lookup', {}, signal)).toEqual({ error: 'Unavailable' });
  state.reply = {
    content: [
      { type: 'text', text: 'first' },
      { type: 'resource_link', uri: 'https://example.test/evidence', name: 'Evidence' },
    ],
  };
  expect(await client.callTool('lookup', {}, signal)).toEqual({ content: state.reply.content });
  expect(state.call.mock.calls[0][2]).toMatchObject({ signal });
  await client.disconnectAll();
});

it('closes its local handle without replaying a call when transport cleanup fails', async () => {
  state.pages = [{ tools: [tool] }];
  const client = new McpHttpConnection();
  await client.connect(server);
  state.close.mockRejectedValueOnce(new Error('Cleanup failed'));
  await expect(client.disconnectAll()).resolves.toBeUndefined();
  await expect(client.callTool('lookup', {})).rejects.toThrow('closed');
  expect(state.call).not.toHaveBeenCalled();
});

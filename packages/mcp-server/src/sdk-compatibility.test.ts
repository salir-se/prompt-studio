// @module-tag integration
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FakeBrowser, startStudioFixture, TEST_TOKEN } from '../../../server/control-ws/test-support';
import { buildServer } from './index';
import { TOOLS } from './tools';

it('executes a harmless read through the real studio server', async () => {
  // The Studio gateway is real (loopback port); only the editor tab is a scripted WebSocket client.
  const studio = await startStudioFixture();
  const tab = await FakeBrowser.connect(studio.url, {
    handler: (action) => (action === 'listDocuments' ? [{ id: 'fixture-document', text: 'Retained document' }] : null),
  });
  const server = buildServer({ port: studio.port, token: TEST_TOKEN });
  const client = new Client({ name: 'fixture-client', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: 'list_documents', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify([{ id: 'fixture-document', text: 'Retained document' }], null, 2) },
    ]);
    expect(tab.received).toEqual([expect.objectContaining({ action: 'listDocuments', params: {} })]);
  } finally {
    await Promise.all([client.close(), server.close()]);
    await tab.close();
    await studio.close();
  }
});

it('starts the actual stdio CLI and discovers the registered Zod tool catalog', async () => {
  const client = new Client({ name: 'fixture-cli-client', version: '1' });
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [fileURLToPath(new URL('./index.ts', import.meta.url)), '--stdio'],
    env: { PROMPT_STUDIO_CONTROL_TOKEN: 'nonfunctional-fixture-token' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual(TOOLS.map(({ name }) => name));
    expect(tools.find(({ name }) => name === 'edit_document')?.inputSchema.required).toContain('text');
  } finally {
    await client.close();
  }
});

it('enforces an explicitly configured small HTTP request budget before handling a fixed canary', async () => {
  const server = new McpServer({ name: 'fixture-server', version: '1' });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 256,
  });
  try {
    await server.connect(transport);
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'canary'.repeat(64), version: '1' },
      },
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(256);
    expect(Buffer.byteLength(body)).toBeLessThan(1024);
    const response = await transport.handleRequest(
      new Request('https://fixture.invalid/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body,
      }),
    );
    expect(response.status).toBe(413);
  } finally {
    await server.close();
  }
});

it('preserves a valid call while enforcing an explicitly configured bounded tool-input budget', async () => {
  const server = new McpServer({ name: 'fixture-server', version: '1' }, { maxToolInputElements: 8 });
  const handler = vi.fn(async ({ values }: { values: number[] }) => ({
    content: [{ type: 'text' as const, text: String(values.length) }],
  }));
  server.registerTool('count', { inputSchema: { values: z.array(z.number()) } }, handler);
  const client = new Client({ name: 'fixture-client', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(await client.callTool({ name: 'count', arguments: { values: [1, 2] } })).toMatchObject({
      content: [{ type: 'text', text: '2' }],
    });
    expect(
      (await client.callTool({ name: 'count', arguments: { values: Array.from({ length: 12 }, () => 1) } })).isError,
    ).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

// @module-tag integration
// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, expect, it } from 'vitest';
import project from '../../examples/order-status/.prompt-studio/project.json' with { type: 'json' };
import { loopbackFetch } from '../../server/loopback-fetch';
import { startDemoOrders } from './demo-orders-mcp';

const stops: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

/** The network guard blocks global fetch; the real MCP client talks to the loopback service through node:http. */
const nodeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const response = await loopbackFetch(String(input), {
    method: init?.method,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    body: init?.body as string | undefined,
  });
  const body = response.status === 202 ? null : await response.text();
  return new Response(body, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
};

it('serves lookup_order over Streamable HTTP with the example schema and the fixed order table', async () => {
  // Given: the demo order service and a real MCP client
  const service = await startDemoOrders();
  stops.push(service.close);
  const client = new Client({ name: 'course-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(service.url), { fetch: nodeFetch }));
  stops.push(() => client.close());
  // When: the client lists tools and looks up a shipped and an unknown order
  const { tools } = await client.listTools();
  const call = async (orderId: string) => {
    const result = (await client.callTool({ name: 'lookup_order', arguments: { order_id: orderId } })) as {
      content: { text: string }[];
    };
    return JSON.parse(result.content[0]?.text ?? '');
  };
  // Then: one tool, with the same description and input schema as the example project
  expect(tools).toEqual([expect.objectContaining(project.tools[0])]);
  // And: the fixed rows come back as JSON text, and any other ID is not_found
  expect(await call('ORD-10423')).toMatchObject({ status: 'shipped', tracking_number: 'PG-55821' });
  expect(await call('ORD-99999')).toEqual({ order_id: 'ORD-99999', status: 'not_found' });
  // And: the service records the IDs it was asked for
  expect(service.calls).toEqual(['ORD-10423', 'ORD-99999']);
});

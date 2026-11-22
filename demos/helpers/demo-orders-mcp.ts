import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import project from '../../examples/order-status/.prompt-studio/project.json' with { type: 'json' };

/**
 * "Demo orders": a loopback Streamable HTTP MCP server for the course recordings (`demos/course/README.md`, "Demo
 * order service"). It exposes one tool, `lookup_order`, with the description and input schema of the finished
 * example project, and answers from a fixed table. Prompt Studio reaches it through its real MCP client.
 */
const LOOKUP_ORDER = project.tools.find((tool) => tool.name === 'lookup_order');
if (!LOOKUP_ORDER) throw new Error('examples/order-status must declare lookup_order.');

export const DEMO_ORDERS: Readonly<Record<string, Record<string, string>>> = {
  'ORD-10423': {
    order_id: 'ORD-10423',
    status: 'shipped',
    carrier: 'ParcelGo',
    tracking_number: 'PG-55821',
    shipped_on: '2026-11-18',
    estimated_delivery: '2026-11-21',
  },
  'ORD-10571': {
    order_id: 'ORD-10571',
    status: 'delayed',
    carrier: 'ParcelGo',
    tracking_number: 'PG-56010',
    delay_reason: 'carrier backlog',
    estimated_delivery: '2026-11-26',
  },
  'ORD-10602': { order_id: 'ORD-10602', status: 'processing', estimated_ship_date: '2026-11-24' },
};

export function lookupOrder(orderId: string): Record<string, string> {
  return DEMO_ORDERS[orderId] ?? { order_id: orderId, status: 'not_found' };
}

/** The same JSON text the service returns, for predefined mocks in Run and in test cases. */
export const orderJson = (orderId: string) => JSON.stringify(lookupOrder(orderId));

function mcpServer(): Server {
  const server = new Server({ name: 'demo-orders', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [LOOKUP_ORDER as never] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'lookup_order')
      return { isError: true, content: [{ type: 'text', text: `Unknown tool ${request.params.name}` }] };
    const orderId = String(request.params.arguments?.order_id ?? '');
    return { content: [{ type: 'text', text: orderJson(orderId) }] };
  });
  return server;
}

export async function startDemoOrders() {
  const calls: string[] = [];
  const http = createServer(async (request, response) => {
    if (request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    if (body?.method === 'tools/call') calls.push(String(body.params?.arguments?.order_id ?? ''));
    // Stateless: one server and transport per request, JSON responses instead of SSE.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = mcpServer();
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('The demo order service could not start.');
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}

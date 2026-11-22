/** Local demo/e2e vendor fixture: real MCP protocol and an OpenAI-shaped model, without paid calls. */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
export async function startMcpTestServer() {
  const counts = { discovery: 0, toolCalls: 0, modelCalls: 0 };
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' });
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('content-type', 'application/json');
    if (req.url === '/mcp') {
      if (body.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }
      let result: unknown;
      if (body.method === 'initialize')
        result = {
          protocolVersion: body.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'Local research tools', version: '1.0.0' },
        };
      else if (body.method === 'tools/list') {
        counts.discovery++;
        result = {
          tools: [
            {
              name: 'lookup_company',
              description: 'Look up a company using the connected research service.',
              inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
            },
          ],
        };
      } else if (body.method === 'tools/call') {
        counts.toolCalls++;
        result = {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ company: 'Acme Research', source: 'Local MCP fixture', verified: true }),
            },
          ],
        };
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Unknown method' } }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      counts.modelCalls++;
      const toolResult = body.messages.findLast((message: { role: string }) => message.role === 'tool');
      const name = body.tools?.[0]?.function?.name;
      const message = toolResult
        ? { role: 'assistant', content: `Company research result:\n${toolResult.content}` }
        : {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'lookup-company',
                type: 'function',
                function: { name: name ?? 'lookup_company', arguments: JSON.stringify({ query: 'Acme' }) },
              },
            ],
          };
      res.end(
        JSON.stringify({
          id: 'local-model',
          object: 'chat.completion',
          created: 0,
          model: 'local-tool-test',
          choices: [{ index: 0, message, finish_reason: toolResult ? 'stop' : 'tool_calls' }],
          usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Unknown fixture route' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    counts,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

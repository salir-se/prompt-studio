import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { callCommand, resolveContext } from './client';
import { toolExecutor, TOOLS } from './tools';

/**
 * The prompt-studio MCP server (task #20; ADR-236) — REMOTE/HTTP BY DEFAULT: a Streamable HTTP
 * endpoint (POST/GET/DELETE /mcp, stateless — every request is self-contained) so an LLM client
 * can point at a URL instead of launching a subprocess; `--stdio` (or MCP_TRANSPORT=stdio)
 * keeps the original stdio mode for local use.
 *
 * AUTH: the endpoint demands `Authorization: Bearer <control token>` — the same token the CLI
 * uses (PROMPT_STUDIO_CONTROL_TOKEN env or the studio's per-boot token file; timing-safe
 * compare). Without it anyone who could reach the port could drive the open editor.
 *
 *   PROMPT_STUDIO_MCP_HOST (default 127.0.0.1)   PROMPT_STUDIO_MCP_PORT (default 5274)
 *   claude mcp add --transport http prompt-studio http://<host>:5274/mcp \
 *     --header "Authorization: Bearer <token>"
 */

/** Loose registerTool binding — the tool table's generic input shapes trip TS2589 otherwise. */
type RegisterTool = (
  name: string,
  config: { title: string; description: string; inputSchema: unknown },
  handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
) => void;

function registerTools(server: McpServer, context: Awaited<ReturnType<typeof resolveContext>>): void {
  const register = server.registerTool.bind(server) as unknown as RegisterTool;
  for (const tool of TOOLS) {
    register(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      toolExecutor(tool, (command, args) => callCommand(context, command, args)),
    );
  }
}

function buildServer(context: Awaited<ReturnType<typeof resolveContext>>): McpServer {
  const server = new McpServer({ name: 'prompt-studio', version: '1.1.0' }, { maxToolInputElements: 10_000 });
  registerTools(server, context);
  return server;
}

function bearerOk(req: IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

async function serveHttp(context: Awaited<ReturnType<typeof resolveContext>>): Promise<void> {
  const host = process.env.PROMPT_STUDIO_MCP_HOST ?? '127.0.0.1';
  const port = Number(process.env.PROMPT_STUDIO_MCP_PORT ?? 5274);
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/mcp') {
        res.writeHead(404).end();
        return;
      }
      if (!bearerOk(req, context.token)) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Unauthorized.' }));
        return;
      }
      try {
        // Stateless per official SDK pattern: fresh server+transport per request; the tools are
        // plain HTTP calls to the studio, so nothing needs to survive between requests.
        const mcp = buildServer(context);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
          // Match Studio's 2 MiB encoded control-command budget, with MCP envelope headroom.
          maxRequestBodySize: 2 * 1024 * 1024 + 4096,
        });
        res.on('close', () => void transport.close());
        await mcp.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error('[prompt-studio-mcp]', error instanceof Error ? error.message : error);
        if (!res.headersSent) res.writeHead(500).end();
      }
    })();
  });
  server.listen(port, host, () => {
    console.error(`prompt-studio MCP (http) listening on http://${host}:${port}/mcp`); // stderr: stdout unused here too
  });
}

async function serveStdio(context: Awaited<ReturnType<typeof resolveContext>>): Promise<void> {
  await buildServer(context).connect(new StdioServerTransport());
}

/** Starts the MCP server: stdio with `--stdio` or MCP_TRANSPORT=stdio, otherwise Streamable HTTP. */
export async function runMcpServer(): Promise<void> {
  const context = await resolveContext();
  if (process.argv.includes('--stdio') || process.env.MCP_TRANSPORT === 'stdio') {
    await serveStdio(context);
  } else {
    await serveHttp(context);
  }
}

// Direct runs: the source entry, or the bundled `mcp/main.js` in the Docker image. The npm launcher calls
// `runMcpServer()` itself.
const entry = process.argv[1]?.replace(/\\/g, '/') ?? '';
const isEntryPoint = ['src/index.ts', 'src/index.js', 'mcp/main.js'].some((suffix) => entry.endsWith(suffix));
if (isEntryPoint) {
  void runMcpServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { bearerOk, buildServer, serveHttp };

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { createLogger } from '@prompt-studio/observability';
import type { McpServerConfig } from '@prompt-studio/types';
import type { McpTool } from './mcp-types';

export class McpCatalogError extends Error {}
/** Direct HTTP/bearer connection for a host that owns its credentials and explicitly controls dispatch. */
export class McpHttpConnection {
  private client: Client | undefined;
  async connect(server: McpServerConfig): Promise<McpTool[]> {
    if (server.authType === 'oauth') throw new Error('This connection requires a host-managed bearer.');
    await this.disconnectAll();
    const client = new Client(
      { name: 'prompt-studio-mcp-client', version: '1.0.0' },
      { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    );
    this.client = client;
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: server.apiKey ? { Authorization: `Bearer ${server.apiKey}` } : {} },
    });
    try {
      await client.connect(transport, { timeout: 30_000 });
      const found: McpTool[] = [];
      const cursors = new Set<string>();
      const names = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const result = await client.listTools(cursor ? { cursor } : {}, { timeout: 30_000 });
        for (const tool of result.tools) {
          if (names.has(tool.name)) throw new McpCatalogError('The MCP catalog contains duplicate tool names.');
          names.add(tool.name);
          found.push({
            serverId: server.id,
            serverName: server.name,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }
        if (found.length > 100) throw new McpCatalogError('The MCP tool catalog exceeds the 100-tool limit.');
        if (!result.nextCursor) return found;
        if (cursors.has(result.nextCursor)) throw new McpCatalogError('The MCP catalog repeated a pagination cursor.');
        cursor = result.nextCursor;
        cursors.add(cursor);
      }
      throw new McpCatalogError('The MCP tool catalog exceeds the five-page limit.');
    } catch (error) {
      await this.disconnectAll();
      throw error;
    }
  }
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!this.client) throw new Error('The MCP connection is closed.');
    signal?.throwIfAborted();
    const result = await this.client.callTool({ name, arguments: args }, undefined, { signal, timeout: 30_000 });
    const content = Array.isArray(result.content) ? result.content : [];
    if (result.isError)
      return {
        error:
          content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n') || 'MCP tool failed.',
      };
    if (result.structuredContent !== undefined) return result.structuredContent;
    if (content.length === 1 && content[0].type === 'text') {
      try {
        return JSON.parse(content[0].text);
      } catch {
        return { text: content[0].text };
      }
    }
    return { content };
  }
  async disconnectAll() {
    const client = this.client;
    this.client = undefined;
    if (client) {
      try {
        await client.close();
      } catch {
        createLogger('mcp').warn('MCP transport cleanup failed after closing its local handle.');
      }
    }
  }
}

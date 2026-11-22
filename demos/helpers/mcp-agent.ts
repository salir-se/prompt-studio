import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * A real MCP client for the tutorial: it starts this repository's MCP server over stdio and calls its tools,
 * exactly as Claude Code or Codex would. Only the agent's conversation text in the video is scripted.
 */
export async function connectAgent(port = process.env.STUDIO_PORT ?? '5273') {
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [path.resolve(import.meta.dirname, '../../packages/mcp-server/src/index.ts'), '--stdio'],
    env: { ...(process.env as Record<string, string>), PROMPT_STUDIO_PORT: port },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'prompt-studio-tutorial', version: '1.0.0' });
  await client.connect(transport);
  return {
    async call(name: string, args: Record<string, unknown> = {}): Promise<string> {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content?: { type: string; text?: string }[];
      };
      const text = (result.content ?? []).map((part) => part.text ?? '').join('\n');
      if (result.isError) throw new Error(`${name} failed: ${text}`);
      return text;
    },
    close: () => client.close(),
  };
}

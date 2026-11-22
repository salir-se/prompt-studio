import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test as base, expect } from '@playwright/test';

/** The course example the MCP outcome tests build on: customer message → `lookup_order` → JSON reply. */
export const ORDER_STATUS_SOURCE = `<role>
You are the order-status assistant. You answer one customer message about one order.
</role>

<tools>
Call lookup_order with the order id you find in {{customer_message}}.
</tools>

<output>
Reply with JSON.
</output>
`;

export interface McpAgent {
  /** Calls one MCP tool; resolves its text, or rejects with the tool's error text. */
  call(name: string, args?: Record<string, unknown>): Promise<string>;
  /** Calls one MCP tool and parses its JSON text. */
  json<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

const appRoot = path.resolve(import.meta.dirname, '../../..');

/**
 * Outcome-test fixture: the built App served by the real standalone runtime with the WebSocket gateway, one browser
 * tab with `order-status` open, and a REAL MCP client that starts this repository's MCP server over stdio — the
 * same path Claude Code or Codex takes.
 */
export const test = base.extend<{ agent: McpAgent }, { builtAssets: string }>({
  builtAssets: [
    async ({}, use) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'studio-mcp-assets-'));
      try {
        await promisify(execFile)('bun', ['run', 'build', '--outDir', directory], { cwd: appRoot, timeout: 120_000 });
        await use(directory);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    { scope: 'worker', timeout: 150_000 },
  ],
  agent: async ({ page, builtAssets }, use) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'studio-mcp-'));
    const token = randomUUID();
    const server = spawn('bun', [path.join(import.meta.dirname, 'mcp-studio-server.ts')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
    });
    server.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    server.stdin.end(JSON.stringify({ directory, token, staticDir: builtAssets, source: ORDER_STATUS_SOURCE }));
    let client: Client | null = null;
    try {
      await expect
        .poll(
          () => {
            if (server.exitCode !== null) throw new Error(`MCP fixture stopped: ${errors}`);
            return output.match(/MCP_STUDIO_READY (http:\/\/127\.0\.0\.1:\d+)/)?.[1] ?? '';
          },
          { timeout: 20_000 },
        )
        .toMatch(/^http:/);
      const url = output.match(/MCP_STUDIO_READY (http:\/\/127\.0\.0\.1:(\d+))/)!;
      await page.addInitScript(() => {
        localStorage.setItem('prompt-studio:shortcut-tips:v1', 'false');
      });
      await page.goto(url[1]);
      await expect(page.getByTestId('prompt-root-order-status')).toBeVisible({ timeout: 30_000 });

      const transport = new StdioClientTransport({
        command: 'bun',
        args: [path.join(appRoot, 'packages/mcp-server/src/index.ts'), '--stdio'],
        env: {
          ...(process.env as Record<string, string>),
          PROMPT_STUDIO_PORT: url[2],
          PROMPT_STUDIO_CONTROL_TOKEN: token,
        },
        stderr: 'pipe',
      });
      client = new Client({ name: 'prompt-studio-e2e', version: '1.0.0' });
      await client.connect(transport);
      const connected = client;
      const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
        const result = (await connected.callTool({ name, arguments: args })) as {
          isError?: boolean;
          content?: { type: string; text?: string }[];
        };
        const text = (result.content ?? []).map((part) => part.text ?? '').join('\n');
        if (result.isError) throw new Error(text);
        return text;
      };
      // The tab registers over WebSocket once its history has booted.
      await expect
        .poll(async () => (JSON.parse(await call('list_targets')) as { ready: boolean }[])[0]?.ready ?? false, {
          timeout: 20_000,
        })
        .toBe(true);
      await use({ call, json: async (name, args) => JSON.parse(await call(name, args)) });
    } finally {
      await client?.close().catch(() => {});
      if (server.exitCode === null) {
        const stopped = once(server, 'exit');
        server.kill('SIGTERM');
        await stopped;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
});

export { expect };

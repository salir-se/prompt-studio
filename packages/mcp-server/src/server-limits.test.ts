// @module-tag integration
// outcome-flags: this standalone CLI has no release-flag reads; tests use its default HTTP/stdio entrypoints.
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  FakeBrowser,
  type StudioFixture,
  startStudioFixture,
  TEST_TOKEN as TOKEN,
} from '../../../server/control-ws/test-support';

const CONTROL_BYTES = 2 * 1024 * 1024;
const HTTP_BYTES = CONTROL_BYTES + 4096;
const entry = fileURLToPath(new URL('./index.ts', import.meta.url));
let studio: StudioFixture;
let tab: FakeBrowser;
let child: ChildProcess;
let client: Client;
let endpoint: string;
let controlPort: number;
/** Commands that reached the editor tab since the last reset. */
let dispatchedBefore = 0;
const dispatchAttempts = (): number => tab.received.length - dispatchedBefore;
let savedText: string | undefined;
let toolRequestBytes = 0;

beforeAll(async () => {
  // Only the editor tab is simulated (a WebSocket client in the browser role); authentication, frame limits
  // and command routing are the real Studio gateway.
  studio = await startStudioFixture();
  tab = await FakeBrowser.connect(studio.url, {
    handler: (action, params) => {
      if (action === 'editDocument') savedText = (params as { text: string }).text;
      return { saved: true };
    },
  });
  controlPort = studio.port;
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const mcpPort = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
  endpoint = `http://127.0.0.1:${mcpPort}/mcp`;
  child = spawn('bun', [entry], {
    env: {
      PATH: process.env.PATH,
      PROMPT_STUDIO_MCP_HOST: '127.0.0.1',
      PROMPT_STUDIO_MCP_PORT: String(mcpPort),
      PROMPT_STUDIO_PORT: String(controlPort),
      PROMPT_STUDIO_CONTROL_TOKEN: TOKEN,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout?.resume();
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error('MCP fixture exited before listening')));
    child.stderr?.on('data', (chunk) => {
      if (String(chunk).includes('listening on')) resolve();
    });
  });
  client = new Client({ name: 'limit-fixture', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
      fetch: async (url, init) => {
        if (typeof init?.body === 'string' && init.body.includes('"method":"tools/call"'))
          toolRequestBytes = Buffer.byteLength(init.body);
        return fetch(url, init);
      },
    }),
  );
});

beforeEach(() => {
  dispatchedBefore = tab.received.length;
  savedText = undefined;
  toolRequestBytes = 0;
});
afterAll(async () => {
  await client?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  await tab?.close();
  await studio?.close();
});

it('preserves an edit whose actual encoded control command is just below the downstream 2 MiB limit', async () => {
  const args = { rootId: 'fixture', text: '' };
  // The control command's encoded size (command name + params), as on the deprecated HTTP relay; the
  // WebSocket frame adds an envelope of ids that fits in the 4 KiB headroom of the frame limit.
  const emptyBytes = Buffer.byteLength(JSON.stringify({ command: 'editDocument', args }));
  const unit = 'A"\\\n界';
  const encodedUnitBytes = Buffer.byteLength(JSON.stringify(unit)) - 2;
  args.text = unit.repeat(Math.floor((CONTROL_BYTES - 1 - emptyBytes) / encodedUnitBytes));
  const downstreamBytes = Buffer.byteLength(JSON.stringify({ command: 'editDocument', args }));
  expect(downstreamBytes).toBeLessThanOrEqual(CONTROL_BYTES);
  expect(downstreamBytes).toBeGreaterThan(CONTROL_BYTES - 16);
  const result = await client.callTool({ name: 'edit_document', arguments: args });
  expect(result.isError).not.toBe(true);
  expect(savedText === args.text).toBe(true);
  expect(dispatchAttempts()).toBe(1);
  expect(toolRequestBytes).toBeGreaterThan(downstreamBytes);
  expect(toolRequestBytes).toBeLessThan(HTTP_BYTES);
});

it('rejects an oversized authorized HTTP tool request before dispatching to Studio', async () => {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 99,
    method: 'tools/call',
    params: { name: 'edit_document', arguments: { rootId: 'fixture', text: 'x'.repeat(HTTP_BYTES) } },
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-03-26',
    },
    body,
  });
  expect(response.status).toBe(413);
  expect(dispatchAttempts()).toBe(0);
  expect(savedText).toBeUndefined();
});

it('preserves authentication before applying the HTTP body budget', async () => {
  const response = await fetch(endpoint, { method: 'POST', body: 'x'.repeat(HTTP_BYTES + 1) });
  expect(response.status).toBe(401);
  expect(dispatchAttempts()).toBe(0);
});

const excessiveArgs = () => ({
  rootId: 'fixture',
  text: 'keep',
  ...Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`extra${index}`, 1])),
});

it('rejects excessive HTTP input elements before a valid edit can reach Studio', async () => {
  const result = await client.callTool({ name: 'edit_document', arguments: excessiveArgs() });
  expect(result.isError).toBe(true);
  expect(dispatchAttempts()).toBe(0);
  expect(savedText).toBeUndefined();
});

it('uses the same input budget on the actual stdio CLI', async () => {
  const stdio = new Client({ name: 'stdio-limit-fixture', version: '1' });
  try {
    await stdio.connect(
      new StdioClientTransport({
        command: 'bun',
        args: [entry, '--stdio'],
        env: { PROMPT_STUDIO_PORT: String(controlPort), PROMPT_STUDIO_CONTROL_TOKEN: TOKEN },
        stderr: 'pipe',
      }),
    );
    const result = await stdio.callTool({ name: 'edit_document', arguments: excessiveArgs() });
    expect(result.isError).toBe(true);
    expect(dispatchAttempts()).toBe(0);
  } finally {
    await stdio.close();
  }
});

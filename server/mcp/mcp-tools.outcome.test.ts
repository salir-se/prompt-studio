// @vitest-environment node
// @module-tag integration
// Outcome: a real Studio HTTP run discovers MCP tools and uses the selected live or mock response in its answer.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LlmChatRequest, LlmProvider } from '@prompt-studio/agent';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_MANIFEST } from '../../src/manifest/default-manifest';
import type { ToolBinding } from '../../src/mcp/contracts';
import { MemoryRepository } from '../../src/prompt-repo/memory-repository';
import { loopbackFetch } from '../loopback-fetch';
import { createRunHandler } from '../run/run-routes';
import { untilDone } from '../test-support/until-done';

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function setup(stateful = false) {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-mcp-outcome-'));
  directories.push(directory);
  const calls: { method: string; authorization: string | undefined; session: string | undefined }[] = [];
  const mcpUrl = await listen(
    createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' });
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const rpc = JSON.parse(Buffer.concat(chunks).toString());
      calls.push({
        method: rpc.method,
        authorization: req.headers.authorization,
        session: req.headers['mcp-session-id'] as string | undefined,
      });
      if (stateful && rpc.method === 'initialize') res.setHeader('mcp-session-id', crypto.randomUUID());
      if (rpc.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }
      const result =
        rpc.method === 'initialize'
          ? {
              protocolVersion: rpc.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'Fixture MCP', version: '1' },
            }
          : rpc.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'lookup_company',
                    description: 'Look up a company',
                    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
                  },
                ],
              }
            : { content: [{ type: 'text', text: JSON.stringify({ company: 'Live company' }) }] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
    }),
  );
  // Only the isolated MCP vendor fixture may cross the suite's network guard. Its replies still traverse real HTTP and the real MCP SDK.
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(mcpUrl + '/')) throw new Error('Unexpected network target');
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const response = await loopbackFetch(url, {
      method: init?.method,
      headers,
      body: init?.body as string | undefined,
    });
    return new Response(response.status === 202 ? null : await response.text(), {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json',
        ...(response.headers.get('mcp-session-id')
          ? { 'mcp-session-id': response.headers.get('mcp-session-id')! }
          : {}),
      },
    });
  });
  const repository = new MemoryRepository('MCP project');
  await repository.initialize();
  await repository.patch([{ path: 'prompts/test.md', text: 'Use lookup_company to research a company.' }]);
  const chat = vi.fn(async (request: LlmChatRequest) => {
    const results = request.messages.flatMap((message) => {
      if (!message || typeof message !== 'object' || !('content' in message) || !Array.isArray(message.content)) {
        return [];
      }
      return message.content.filter((block) => block.type === 'tool_result');
    });
    return {
      content:
        results.length >= (stateful ? 2 : 1)
          ? [{ type: 'text' as const, text: JSON.stringify(results[results.length - 1]) }]
          : [
              {
                type: 'tool_use' as const,
                id: `lookup-${results.length + 1}`,
                name: 'lookup_company',
                input: { query: 'Example' },
              },
            ],
      usage: { inputTokens: 20, outputTokens: 10 },
      stopReason: results.length >= (stateful ? 2 : 1) ? 'end_turn' : 'tool_use',
      model: 'fixture-model',
    };
  });
  const handler = createRunHandler({
    runtime: {
      repository,
      repoRoot: directory,
      checkout: null,
      repoName: repository.name,
      resolvedManifest: { status: 'ok', source: 'app', manifest: DEFAULT_MANIFEST },
    },
    directory: path.join(directory, 'runtime'),
    studioToken: 'token',
    allowedOrigins: ['http://localhost:5273'],
    createProvider: () => ({ id: 'openai', name: 'Fixture model', chat }) as unknown as LlmProvider,
  });
  const url = await listen(
    createServer((req, res) => {
      void handler(req, res);
    }),
  );
  async function send(suffix: string, body?: unknown) {
    const response = await loopbackFetch(url + '/__studio/run' + suffix, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-studio-token': 'token' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  const id = crypto.randomUUID();
  await send('/settings', { provider: 'openai', model: 'fixture-model', apiKey: 'model-secret' });
  expect(
    (
      await send('/mcp-servers', {
        action: 'save',
        server: { id, name: 'Research MCP', url: mcpUrl + '/mcp', apiKey: 'mcp-secret' },
      })
    ).status,
  ).toBe(200);
  const discovered = await send('/mcp-servers', { action: 'discover', id });
  expect(discovered.status).toBe(200);
  const tool = discovered.body.servers[0].tools[0];
  const binding: ToolBinding = {
    name: 'lookup_company',
    serverId: id,
    toolName: 'lookup_company',
    schemaHash: tool.schemaHash,
    mode: 'mock',
    mock: '{"company":"Mock company"}',
  };
  const input = {
    runId: crypto.randomUUID(),
    projectId: repository.projectId,
    revision: repository.revision,
    promptPath: 'prompts/test.md',
    source: 'Use lookup_company.',
    inputs: {},
    userMessage: 'Find Example',
    skills: [],
    provider: 'openai',
    model: 'fixture-model',
    tools: [binding],
  };
  return { send, input, binding, calls, chat, directory };
}
it.each(['mock', 'real'] as const)(
  'uses a selected %s MCP result in the final model answer and captures its trace',
  async (mode) => {
    const { send, input, calls, directory } = await setup();
    input.tools[0].mode = mode;
    const before = calls.length;
    expect((await send('', input)).status).toBe(202);
    let run: any;
    await untilDone(async () => {
      run = (await send(`/${input.runId}?projectId=${input.projectId}`)).body.run;
      expect(run.status).toBe('completed');
    });
    expect(run.output).toContain(mode === 'mock' ? 'Mock company' : 'Live company');
    expect(run.usage).toEqual({ inputTokens: 40, outputTokens: 20 });
    expect(run.toolCalls).toHaveLength(1);
    expect(run.toolCalls[0]).toMatchObject({
      mode,
      input: { query: 'Example' },
      result: { company: mode === 'mock' ? 'Mock company' : 'Live company' },
    });
    if (mode === 'mock') expect(calls).toHaveLength(before);
    else expect(calls.find((call) => call.method === 'tools/call')?.authorization).toBe('Bearer mcp-secret');
    expect(JSON.stringify(run)).not.toContain('mcp-secret');
    expect(await readFile(path.join(directory, 'runtime/mcp/servers.json'), 'utf8')).not.toContain('mcp-secret');
    // Retrying the same run id retrieves its result without executing a second real call.
    expect((await send('', input)).status).toBe(202);
    expect(calls.filter((call) => call.method === 'tools/call')).toHaveLength(mode === 'real' ? 1 : 0);
  },
);
it('blocks an invalid mock before the model or MCP server is called', async () => {
  const { send, input, calls, chat } = await setup();
  const before = calls.length;
  input.tools[0].mock = '';
  expect((await send('', input)).status).toBe(400);
  expect(chat).not.toHaveBeenCalled();
  expect(calls).toHaveLength(before);
});
it('freezes distinct per-test fixtures for an evaluation without calling the real server', async () => {
  const { send, input, binding, calls } = await setup();
  const before = calls.length;
  const suite = {
    id: 'mcp-cases',
    name: 'MCP fixtures',
    promptPath: input.promptPath,
    cases: ['One', 'Two'].map((name) => ({
      id: name,
      name,
      inputs: {},
      userMessage: 'Research',
      checks: { contains: [name] },
      tools: [{ ...binding, mock: JSON.stringify({ company: name }) }],
    })),
  };
  expect((await send('/suites', { projectId: input.projectId, revision: input.revision, suite })).status).toBe(200);
  const id = crypto.randomUUID();
  const response = await send('/evaluations', {
    id,
    projectId: input.projectId,
    revision: input.revision,
    suiteId: suite.id,
    candidates: [{ id: 'working', label: 'Current draft', source: input.source }],
    provider: input.provider,
    model: input.model,
    skills: [],
    tools: [{ ...binding, mode: 'real' }],
  });
  expect(response.status).toBe(202);
  let evaluation: any;
  await untilDone(async () => {
    evaluation = (await send(`/evaluations/${id}?projectId=${input.projectId}`)).body.evaluation;
    expect(evaluation.status).toBe('completed');
  });
  expect(evaluation.results.map((result: any) => result.status)).toEqual(['passed', 'passed']);
  expect(evaluation.results.map((result: any) => result.toolCalls[0].mode)).toEqual(['mock', 'mock']);
  expect(calls).toHaveLength(before);
});

it('reuses the same real MCP session for sequential tools within one HTTP run', async () => {
  const { send, input, calls } = await setup(true);
  input.tools[0].mode = 'real';
  const before = calls.length;
  expect((await send('', input)).status).toBe(202);
  let run: any;
  await untilDone(async () => {
    run = (await send(`/${input.runId}?projectId=${input.projectId}`)).body.run;
    expect(run.status).toBe('completed');
  });
  const runCalls = calls.slice(before);
  expect(runCalls.filter((call) => call.method === 'initialize')).toHaveLength(1);
  const dispatches = runCalls.filter((call) => call.method === 'tools/call');
  expect(dispatches).toHaveLength(2);
  expect(dispatches[0].session).toBeTruthy();
  expect(dispatches[1].session).toBe(dispatches[0].session);
  expect(run.output).toContain('Live company');
  expect(run.toolCalls).toHaveLength(2);
});

// @vitest-environment node
// @module-tag integration
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalRunStore } from '../run/local-store';
import { untilDone } from '../test-support/until-done';
import { StudioMcpRegistry } from './registry';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-mcp-'));
  directories.push(directory);
  const server = { id: crypto.randomUUID(), name: 'Research', url: 'https://mcp.example.test/mcp' };
  const manager = {
    connect: vi.fn(async () => [
      {
        serverId: server.id,
        name: 'lookup',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    ]),
    callTool: vi.fn(async () => ({ found: true })),
    disconnectAll: vi.fn(async () => {}),
  };
  const registry = new StudioMcpRegistry(new LocalRunStore(directory), () => manager);
  await registry.save({ ...server, apiKey: 'private-bearer' });
  await registry.discover(server.id);
  const listed = (await registry.list())[0];
  const binding = {
    name: 'lookup_company',
    serverId: server.id,
    toolName: 'lookup',
    schemaHash: listed.tools[0].schemaHash,
    mode: 'mock' as const,
    mock: '{"company":"Example"}',
  };
  return { directory, manager, registry, server, binding };
}
it('keeps bearer credentials in memory, isolates them by endpoint and retains discovered tools after restart', async () => {
  const { registry, server, directory } = await setup();
  expect(JSON.stringify(await registry.list())).not.toContain('private-bearer');
  expect(await readFile(path.join(directory, 'mcp/servers.json'), 'utf8')).not.toContain('private-bearer');
  const reopened = new StudioMcpRegistry(new LocalRunStore(directory));
  expect((await reopened.list())[0]).toMatchObject({ credentialAvailable: false, tools: [{ name: 'lookup' }] });
  await registry.save({ ...server, url: 'https://other.example.test/mcp' });
  expect((await registry.list())[0]).toMatchObject({ credentialAvailable: false, tools: [] });
});
it('returns a predefined mock without connecting or calling the MCP server, and validates its input', async () => {
  const { registry, manager, binding } = await setup();
  manager.connect.mockClear();
  const frozen = await registry.freeze([binding]);
  expect(await registry.call(frozen[0], { query: 'Example' }, new AbortController().signal)).toEqual({
    company: 'Example',
  });
  expect(manager.connect).not.toHaveBeenCalled();
  expect(manager.callTool).not.toHaveBeenCalled();
  await expect(registry.call(frozen[0], { query: 42 }, new AbortController().signal)).rejects.toThrow(/input/i);
});
it('executes only an explicitly selected real tool and closes its connection', async () => {
  const { registry, manager, binding } = await setup();
  const frozen = await registry.freeze([{ ...binding, mode: 'real' }]);
  expect(await registry.call(frozen[0], { query: 'Example' }, new AbortController().signal)).toEqual({ found: true });
  expect(manager.callTool).toHaveBeenCalledWith('lookup', { query: 'Example' }, expect.any(AbortSignal));
  expect(manager.disconnectAll).toHaveBeenCalled();
});
it('refuses duplicate aliases, missing mocks, stale schemas, removed servers and non-local insecure URLs', async () => {
  const { registry, binding, server } = await setup();
  await expect(registry.freeze([binding, binding])).rejects.toThrow(/unique/i);
  await expect(registry.freeze([{ ...binding, mock: '' }])).rejects.toThrow(/mock/i);
  await expect(registry.freeze([{ ...binding, schemaHash: 'old' }])).rejects.toThrow(/changed/i);
  await expect(registry.save({ ...server, url: 'http://example.test/mcp' })).rejects.toThrow(/HTTPS/i);
  await registry.remove(server.id);
  await expect(registry.freeze([binding])).rejects.toThrow(/unavailable/i);
});
it('does not call a real tool after cancellation or silently replace a failed call with a mock', async () => {
  const { registry, manager, binding } = await setup();
  const frozen = await registry.freeze([{ ...binding, mode: 'real' }]);
  const controller = new AbortController();
  controller.abort();
  await expect(registry.call(frozen[0], { query: 'Example' }, controller.signal)).rejects.toThrow();
  expect(manager.callTool).not.toHaveBeenCalled();
  manager.callTool.mockRejectedValueOnce(new Error('private-bearer is invalid'));
  await expect(registry.call(frozen[0], { query: 'Example' }, new AbortController().signal)).rejects.toThrow(
    /MCP tool call failed/,
  );
});

it('rechecks execution policy for cached catalogs while preserving mocked testing', async () => {
  const { registry, binding, directory, manager } = await setup();
  const file = path.join(directory, 'mcp/servers.json');
  const cached = JSON.parse(await readFile(file, 'utf8'));
  cached[0].tools[0].name = 'email_send_message';
  cached[0].tools[0].canCall = true;
  await writeFile(file, JSON.stringify(cached));
  await expect(registry.freeze([{ ...binding, toolName: 'email_send_message', mode: 'real' }])).rejects.toThrow(
    /unavailable in Studio/i,
  );
  expect((await registry.list())[0].tools[0].canCall).toBe(false);
  const mock = await registry.freeze([{ ...binding, toolName: 'email_send_message' }]);
  manager.connect.mockClear();
  expect(await registry.call(mock[0], { query: 'Example' }, new AbortController().signal)).toEqual({
    company: 'Example',
  });
  expect(manager.connect).not.toHaveBeenCalled();
});

it('preserves one MCP session across tool calls in a run and closes it at the run boundary', async () => {
  const { registry, binding, manager } = await setup();
  const [tool] = await registry.freeze([{ ...binding, mode: 'real' }]);
  manager.connect.mockClear();
  manager.disconnectAll.mockClear();
  const session = registry.session();
  const signal = new AbortController().signal;
  await session.call(tool, { query: 'First step' }, signal);
  await session.call(tool, { query: 'Follow-up step' }, signal);
  expect(manager.connect).toHaveBeenCalledOnce();
  expect(manager.disconnectAll).not.toHaveBeenCalled();
  await session.close();
  expect(manager.disconnectAll).toHaveBeenCalledOnce();
});

it('closes a connection that finishes opening after its run was cancelled', async () => {
  const { registry, binding, manager } = await setup();
  const [tool] = await registry.freeze([{ ...binding, mode: 'real' }]);
  const found = await manager.connect();
  let finish!: (tools: typeof found) => void;
  manager.connect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  manager.disconnectAll.mockClear();
  const session = registry.session();
  const controller = new AbortController();
  const pending = session.call(tool, { query: 'Example' }, controller.signal);
  const refused = expect(pending).rejects.toThrow();
  await untilDone(() => expect(finish).toBeTypeOf('function'));
  controller.abort();
  await session.close();
  finish(found);
  await refused;
  expect(manager.callTool).not.toHaveBeenCalled();
  expect(manager.disconnectAll).toHaveBeenCalledOnce();
});

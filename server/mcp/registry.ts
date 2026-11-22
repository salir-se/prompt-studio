import { McpCatalogError, McpHttpConnection } from '@prompt-studio/agent/mcp-http-connection';
import { isAgentBlockedMcpToolName, validateMcpToolInput } from '@prompt-studio/agent/mcp-tools';
import { type } from 'arktype';
import type { StudioMcpServer, StudioMcpTool, ToolBinding } from '../../src/mcp/contracts';
import { fingerprint, type LocalRunStore } from '../run/local-store';

type Manager = Pick<McpHttpConnection, 'connect' | 'callTool' | 'disconnectAll'>;
type Connection = { manager: Manager; tools: Awaited<ReturnType<Manager['connect']>> };
type SavedServer = Omit<StudioMcpServer, 'credentialAvailable'>;
export interface FrozenTool extends ToolBinding {
  tool: StudioMcpTool;
  server: Pick<SavedServer, 'id' | 'name' | 'url'>;
  credential?: string;
}
const serverSchema = type({
  '+': 'reject',
  id: /^[a-f0-9-]{36}$/i,
  name: 'string > 0 & string <= 100',
  url: 'string > 0 & string <= 2048',
  'apiKey?': /^[\x21-\x7e]{1,4096}$/,
});
function endpoint(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error(
      'Use an HTTPS MCP URL, or HTTP on localhost. Supply bearer credentials separately, without URL queries.',
    );
  return url.href;
}
function hash(tool: Pick<StudioMcpTool, 'inputSchema'>) {
  return fingerprint(JSON.stringify(tool.inputSchema));
}
export function mockResult(binding: ToolBinding): Record<string, unknown> | unknown[] {
  try {
    const value: unknown = JSON.parse(binding.mock ?? '');
    if (!value || typeof value !== 'object') throw new Error();
    return value as Record<string, unknown> | unknown[];
  } catch {
    throw new Error(`Supply a mock JSON object or array for ${binding.name}.`);
  }
}

/** Connections are local application settings. Only schema snapshots and non-secret addresses are persisted. */
export class StudioMcpRegistry {
  private readonly credentials = new Map<string, { url: string; value: string }>();
  private writes = Promise.resolve();
  constructor(
    private readonly files: LocalRunStore,
    private readonly manager: () => Manager = () => new McpHttpConnection(),
  ) {}
  private async saved() {
    await this.writes;
    return this.files.read<SavedServer[]>('mcp/servers.json', []);
  }
  private change(update: (servers: SavedServer[]) => SavedServer[]) {
    const operation = this.writes.then(async () => {
      const servers = await this.files.read<SavedServer[]>('mcp/servers.json', []);
      await this.files.write('mcp/servers.json', update(servers));
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  private credential(server: Pick<SavedServer, 'id' | 'url'>) {
    const key = this.credentials.get(server.id);
    return key?.url === server.url ? key.value : undefined;
  }
  private clean<T>(value: T, credential?: string): T {
    const keys = [...this.credentials.values()].map((key) => key.value).concat(credential ? [credential] : []);
    return JSON.parse(
      JSON.stringify(value, (_name, item: unknown) => {
        if (typeof item !== 'string') return item;
        return keys.reduce(
          (text, key) => (text === key ? '[redacted]' : key.length >= 8 ? text.replaceAll(key, '[redacted]') : text),
          item,
        );
      }),
    ) as T;
  }
  async list(): Promise<StudioMcpServer[]> {
    return (await this.saved()).map((server) => ({
      ...server,
      credentialAvailable: !!this.credential(server),
      tools: server.tools.map((tool) => ({ ...tool, canCall: !isAgentBlockedMcpToolName(tool.name) })),
    }));
  }
  async save(raw: unknown) {
    const input = serverSchema(raw);
    if (input instanceof type.errors) throw new Error('Supply a server name, URL and optional bearer token.');
    const url = endpoint(input.url);
    await this.change((servers) => {
      const previous = servers.find((server) => server.id === input.id);
      if (!previous && servers.length >= 20) throw new Error('Studio supports at most 20 registered MCP servers.');
      return [
        ...servers.filter((server) => server.id !== input.id),
        {
          id: input.id,
          name: input.name,
          url,
          tools: previous?.url === url ? previous.tools : [],
        },
      ];
    });
    if (input.apiKey) this.credentials.set(input.id, { url, value: input.apiKey });
    else if (this.credentials.get(input.id)?.url !== url) this.credentials.delete(input.id);
    return this.list();
  }
  async remove(id: string) {
    await this.change((servers) => servers.filter((server) => server.id !== id));
    this.credentials.delete(id);
    return this.list();
  }
  private async connect(server: Pick<SavedServer, 'id' | 'name' | 'url'>, manager: Manager) {
    return manager.connect({ ...server, enabled: true, directConnect: true, apiKey: this.credential(server) });
  }
  async discover(id: string) {
    const server = (await this.saved()).find((server) => server.id === id);
    if (!server) throw new Error('This MCP server is unavailable.');
    const manager = this.manager();
    try {
      const found = await this.connect(server, manager);
      if (found.length > 100 || Buffer.byteLength(JSON.stringify(found)) > 256_000)
        throw new Error('Tool catalog too large');
      const tools = this.clean(
        found.map((tool) => ({
          name: tool.name,
          description: tool.description ?? `MCP tool: ${tool.name}`,
          inputSchema: tool.inputSchema,
          schemaHash: hash(tool),
          canCall: !isAgentBlockedMcpToolName(tool.name),
        })),
      );
      await this.change((servers) =>
        servers.map((current) => (current.id === id && current.url === server.url ? { ...current, tools } : current)),
      );
      return this.list();
    } catch (error) {
      if (error instanceof McpCatalogError) throw error;
      throw new Error('MCP discovery failed. Check the server URL, bearer token and availability.', { cause: error });
    } finally {
      await manager.disconnectAll();
    }
  }
  async freeze(bindings: readonly ToolBinding[] = []): Promise<FrozenTool[]> {
    if (
      bindings.length > 32 ||
      new Set(bindings.map((binding) => binding.name)).size !== bindings.length ||
      new Set(bindings.map((binding) => `${binding.serverId}/${binding.toolName}`)).size !== bindings.length
    )
      throw new Error('Choose at most 32 tools with unique prompt names.');
    const servers = await this.saved();
    const frozen = bindings.map((binding) => {
      const server = servers.find((server) => server.id === binding.serverId);
      const tool = server?.tools.find((tool) => tool.name === binding.toolName);
      if (!server || !tool) throw new Error(`The ${binding.name} MCP tool is unavailable. Open MCP server settings.`);
      if (tool.schemaHash !== binding.schemaHash)
        throw new Error(`The ${binding.name} schema changed. Remove and reselect this tool.`);
      if (binding.mode === 'mock') mockResult(binding);
      else if (isAgentBlockedMcpToolName(binding.toolName))
        throw new Error('Real calls for this tool are unavailable in Studio. Use a mock response.');
      return structuredClone({
        ...binding,
        tool,
        server: { id: server.id, name: server.name, url: server.url },
        credential: this.credential(server),
      });
    });
    if (Buffer.byteLength(JSON.stringify(frozen.map((binding) => binding.tool))) > 128_000)
      throw new Error('Selected tool schemas exceed 128 KiB. Choose fewer tools.');
    return frozen;
  }
  session() {
    const connections = new Map<string, Connection>();
    let closed = false;
    return {
      call: (binding: FrozenTool, input: Record<string, unknown>, signal: AbortSignal) =>
        this.dispatch(binding, input, signal, connections, () => closed),
      close: async () => {
        closed = true;
        await Promise.all([...connections.values()].map(({ manager }) => manager.disconnectAll()));
        connections.clear();
      },
    };
  }
  async call(binding: FrozenTool, input: Record<string, unknown>, signal: AbortSignal) {
    const session = this.session();
    try {
      return await session.call(binding, input, signal);
    } finally {
      await session.close();
    }
  }
  private async dispatch(
    binding: FrozenTool,
    input: Record<string, unknown>,
    signal: AbortSignal,
    connections: Map<string, Connection>,
    closed: () => boolean,
  ) {
    signal.throwIfAborted();
    if (closed()) throw new Error('The MCP run session is closed.');
    validateMcpToolInput(binding.tool.inputSchema, input);
    if (binding.mode === 'mock') return mockResult(binding);
    if (isAgentBlockedMcpToolName(binding.toolName))
      throw new Error('Real calls for this tool are unavailable in Studio. Use a mock response.');
    const current = (await this.saved()).find((server) => server.id === binding.serverId);
    if (!current || current.url !== binding.server.url) throw new Error('The MCP server changed. Start a new run.');
    const connection = connections.get(binding.serverId);
    const manager = connection?.manager ?? this.manager();
    try {
      const tools =
        connection?.tools ??
        (await manager.connect({
          ...binding.server,
          enabled: true,
          directConnect: true,
          apiKey: binding.credential,
        }));
      signal.throwIfAborted();
      if (closed()) throw new Error('The MCP run session is closed.');
      const tool = tools.find((tool) => tool.name === binding.toolName);
      if (!tool || hash(tool) !== binding.schemaHash)
        throw new Error('The MCP tool schema changed. Refresh its catalog.');
      connections.set(binding.serverId, { manager, tools });
      const result = this.clean(await manager.callTool(binding.toolName, input, signal), binding.credential);
      if (Buffer.byteLength(JSON.stringify(result)) > 128_000) throw new Error('MCP result exceeds 128 KiB');
      return result && typeof result === 'object' ? (result as Record<string, unknown> | unknown[]) : { value: result };
    } catch {
      throw new Error('MCP tool call failed. Check the server connection or refresh its tool catalog.');
    } finally {
      if (!connections.has(binding.serverId)) await manager.disconnectAll();
    }
  }
}

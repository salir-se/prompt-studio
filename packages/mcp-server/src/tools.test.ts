// @module-tag pure
import { describe, expect, it, vi } from 'vitest';
import { callCommand, resolveContext } from './client';
import { toolExecutor, TOOLS } from './tools';

/**
 * The tool table's contract (task #20): every tool maps to exactly one control-API command with
 * the right args (the CLI's wire contract, pinned from the MCP side too), tool inputs are zod
 * validated, and command errors propagate as tool errors. The client's env/file token
 * resolution is covered with injectables; no studio needed.
 */

describe('TOOLS table', () => {
  it('exposes the nine editor operations with unique snake_case names', () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(TOOLS.length);
    expect(names).toEqual([
      'list_documents',
      'open_document',
      'read_document',
      'edit_document',
      'list_configurations',
      'create_configuration',
      'switch_configuration',
      'reset_document',
      'history',
    ]);
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20); // real guidance for the LLM
    }
  });

  it('routes each tool input to its control command verbatim', async () => {
    const call = vi.fn(async () => ({ ok: true }));
    const read = TOOLS.find((tool) => tool.name === 'read_document')!;
    await toolExecutor(read, call)({ rootId: 'scout', variantSymbol: 'CRITIC_PROMPT' });
    expect(call).toHaveBeenCalledWith('readDocument', { rootId: 'scout', variantSymbol: 'CRITIC_PROMPT' });

    const edit = TOOLS.find((tool) => tool.name === 'edit_document')!;
    await toolExecutor(edit, call)({ rootId: 'scout', text: 'NEW', message: 'llm tweak' });
    expect(call).toHaveBeenLastCalledWith('editDocument', { rootId: 'scout', text: 'NEW', message: 'llm tweak' });

    const create = TOOLS.find((tool) => tool.name === 'create_configuration')!;
    await toolExecutor(create, call)({ name: 'Trial', fromBaseline: 'repository' });
    expect(call).toHaveBeenLastCalledWith('createConfiguration', {
      name: 'Trial',
      fromBaseline: 'repository',
    });
  });

  it('returns MCP text content: document text verbatim, everything else JSON', async () => {
    const call = vi.fn(async () => ({ rootId: 'scout', text: 'YOU ARE SCOUT.', source: 'working' }));
    const read = TOOLS.find((tool) => tool.name === 'read_document')!;
    await expect(toolExecutor(read, call)({ rootId: 'scout' })).resolves.toEqual({
      content: [{ type: 'text', text: 'YOU ARE SCOUT.' }],
    });

    call.mockResolvedValue([{ id: 'scout' }] as unknown as { rootId: string; text: string; source: string });
    const list = TOOLS.find((tool) => tool.name === 'list_documents')!;
    const listed = await toolExecutor(list, call)({});
    expect(
      listed.content[0]?.text,
      'A non-document tool result must be pretty-printed JSON, not a loose substring of the command payload',
    ).toBe(JSON.stringify([{ id: 'scout' }], null, 2));
  });

  it('propagates command failures as tool errors', async () => {
    const call = vi.fn(async () => {
      throw new Error('Open "scout" first (openDocument) — edits apply to the loaded document.');
    });
    const edit = TOOLS.find((tool) => tool.name === 'edit_document')!;
    await expect(toolExecutor(edit, call)({ rootId: 'scout', text: 'x' })).rejects.toThrow('Open "scout" first');
  });

  it('validates edit_document inputs through the zod shape — text is required', () => {
    const edit = TOOLS.find((tool) => tool.name === 'edit_document')!;
    const parsed = edit.inputSchema.text!.safeParse(undefined);
    expect(parsed.success).toBe(false);
    expect(edit.inputSchema.text!.safeParse('some text').success).toBe(true);
  });
});

describe('resolveContext', () => {
  it('prefers the env token (the docker workflow), then the per-boot token file; defaults the port', async () => {
    process.env.PROMPT_STUDIO_CONTROL_TOKEN = 'pinned-token';
    try {
      const fromEnv = await resolveContext(async () => {
        throw new Error('file must not be read when the env token is set');
      });
      expect(fromEnv).toMatchObject({ port: 5273, token: 'pinned-token' });

      delete process.env.PROMPT_STUDIO_CONTROL_TOKEN;
      const readFileImpl = vi.fn(async (port: string) => {
        expect(port, 'The per-boot token file is requested for the studio port, not an unrelated path').toBe('5273');
        return '  token-from-file  ';
      });
      const fromFile = await resolveContext(readFileImpl);
      expect(fromFile, 'A file token is trimmed and the default port stays 5273').toMatchObject({
        port: 5273,
        token: 'token-from-file',
      });

      process.env.PROMPT_STUDIO_CONTROL_TOKEN = '';
      const readAfterEmpty = vi.fn(async () => 'from-empty-env');
      const fromEmpty = await resolveContext(readAfterEmpty);
      expect(
        readAfterEmpty,
        'An empty PROMPT_STUDIO_CONTROL_TOKEN must fall through to the token file',
      ).toHaveBeenCalledWith('5273');
      expect(fromEmpty.token).toBe('from-empty-env');
    } finally {
      delete process.env.PROMPT_STUDIO_CONTROL_TOKEN;
    }
  });
});

describe('callCommand', () => {
  it('POSTs the control command with the studio token and returns the result', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true, result: { id: 'scout' } }));
    const result = await callCommand(
      { port: 5273, token: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch },
      'readDocument',
      { rootId: 'scout' },
    );

    expect(result, 'A successful control call must return the studio result, not the envelope').toEqual({
      id: 'scout',
    });
    expect(fetchImpl, 'The control RPC is one POST').toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url, 'The MCP client must call the studio control endpoint on 127.0.0.1').toBe(
      'http://127.0.0.1:5273/__control/command',
    );
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-studio-token'), 'The control token must travel in x-studio-token').toBe(
      'tok',
    );
    expect(JSON.parse(String(init.body)), 'The body is the command name plus its args').toEqual({
      command: 'readDocument',
      args: { rootId: 'scout' },
    });
  });

  it('throws a readable error when the studio cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      callCommand({ port: 5273, token: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch }, 'listDocuments'),
      'A network failure must name the port instead of leaking the raw stack',
    ).rejects.toThrow('Cannot reach the studio on port 5273');
  });

  it('throws the studio error when the command is rejected', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: false, error: 'Open "scout" first' }, { status: 400 }));
    await expect(
      callCommand({ port: 5273, token: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch }, 'editDocument'),
      'A rejected command must surface the studio error text',
    ).rejects.toThrow('Open "scout" first');
  });
});

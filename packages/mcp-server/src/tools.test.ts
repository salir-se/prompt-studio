// @module-tag pure
import { describe, expect, it, vi } from 'vitest';
import { resolveContext } from './client';
import { toolExecutor, TOOLS } from './tools';

/**
 * The tool table's contract (task #20): every tool maps to exactly one control-API command with
 * the right args (the CLI's wire contract, pinned from the MCP side too), tool inputs are zod
 * validated, and command errors propagate as tool errors. The client's env/file token
 * resolution is covered with injectables; no studio needed.
 */

describe('TOOLS table', () => {
  it('exposes the editor and section operations plus list_targets with unique snake_case names', () => {
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
      'list_sections',
      'read_section',
      'edit_section',
      'insert_section',
      'move_section',
      'remove_section',
      'get_design',
      'set_design',
      'verify_sample',
      'list_workflow_patterns',
      'apply_workflow_pattern',
      'list_checks',
      'run_checks',
      'get_findings',
      'propose_check',
      'get_proposal_status',
      'list_targets',
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

  it('passes browserId separately and only when the input names one; list_targets takes no browserId', async () => {
    // Given: a recording caller
    const call = vi.fn(async () => ({ ok: true }));
    const read = TOOLS.find((tool) => tool.name === 'read_document')!;
    // When: a tool input names a tab
    await toolExecutor(read, call)({ rootId: 'scout', browserId: 'tab-2' });
    // Then: the command args exclude it and it travels as the third argument
    expect(call).toHaveBeenLastCalledWith('readDocument', { rootId: 'scout' }, 'tab-2');
    for (const tool of TOOLS) {
      if (tool.name === 'list_targets') expect(tool.inputSchema.browserId).toBeUndefined();
      else expect(tool.inputSchema.browserId?.safeParse(undefined).success, tool.name).toBe(true);
    }
  });

  it('routes the section tools to the section commands with their inputs', async () => {
    // Given: a recording caller
    const call = vi.fn(async () => ({ ok: true }));
    const tool = (name: string) => TOOLS.find((candidate) => candidate.name === name)!;
    // When: each section tool runs
    await toolExecutor(tool('list_sections'), call)({ rootId: 'order-status' });
    await toolExecutor(tool('edit_section'), call)({ rootId: 'order-status', sectionId: 'role', body: 'B' });
    await toolExecutor(
      tool('insert_section'),
      call,
    )({ rootId: 'o', sectionId: 'role', tag: 'examples', position: 'after' });
    await toolExecutor(tool('move_section'), call)({ rootId: 'o', sectionId: 'role', direction: 'down' });
    // Then: each reaches its catalog command verbatim, and the enums are validated by the zod shape
    expect(call.mock.calls.map((args) => args[0])).toEqual([
      'listSections',
      'editSection',
      'insertSection',
      'moveSection',
    ]);
    expect(call).toHaveBeenCalledWith('editSection', { rootId: 'order-status', sectionId: 'role', body: 'B' });
    expect(tool('move_section').inputSchema.direction!.safeParse('left').success).toBe(false);
    expect(tool('insert_section').inputSchema.position!.safeParse('firstChild').success).toBe(true);
  });

  it('routes the design tools and validates their inputs', async () => {
    // Given: a recording caller and the design tools
    const call = vi.fn(async () => ({ ok: true }));
    const tool = (name: string) => TOOLS.find((candidate) => candidate.name === name)!;
    const output = { kind: 'json', description: 'Reply.', jsonSchema: { type: 'object' }, examples: [{}] };
    // When: the agent sets an output contract, verifies a sample and applies a pattern
    await toolExecutor(tool('set_design'), call)({ rootId: 'o', output });
    await toolExecutor(tool('verify_sample'), call)({ rootId: 'o', sample: '{}' });
    await toolExecutor(tool('apply_workflow_pattern'), call)({ rootId: 'o', sectionId: 'tools', patternId: 'tools' });
    // Then: each reaches its command with the input verbatim; contracts must be objects
    expect(call).toHaveBeenCalledWith('setDesign', { rootId: 'o', output });
    expect(call).toHaveBeenCalledWith('verifySample', { rootId: 'o', sample: '{}' });
    expect(call).toHaveBeenCalledWith('applyWorkflowPattern', { rootId: 'o', sectionId: 'tools', patternId: 'tools' });
    expect(tool('set_design').inputSchema.output!.safeParse('json').success).toBe(false);
    expect(tool('verify_sample').inputSchema.sample!.safeParse(undefined).success).toBe(false);
  });

  it('routes the verification tools; propose_check needs a kind and get_proposal_status a proposalId', async () => {
    // Given: a recording caller
    const call = vi.fn(async () => ({ ok: true }));
    const tool = (name: string) => TOOLS.find((candidate) => candidate.name === name)!;
    // When: the agent proposes a check and asks for its status
    const rule = { kind: 'required-tool', name: 'lookup_order' };
    await toolExecutor(tool('propose_check'), call)({ rootId: 'o', sectionId: 'tools', kind: 'rule', rule });
    await toolExecutor(tool('get_proposal_status'), call)({ proposalId: 'proposal-1' });
    // Then: both reach their commands verbatim, and the inputs are validated
    expect(call).toHaveBeenCalledWith('proposeCheck', { rootId: 'o', sectionId: 'tools', kind: 'rule', rule });
    expect(call).toHaveBeenCalledWith('getProposalStatus', { proposalId: 'proposal-1' });
    expect(tool('propose_check').inputSchema.kind!.safeParse('approve').success).toBe(false);
    expect(tool('get_proposal_status').inputSchema.proposalId!.safeParse(undefined).success).toBe(false);
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

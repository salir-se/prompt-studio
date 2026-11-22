// @vitest-environment node
// @module-tag pure
import { ControlCommandError } from '@prompt-studio/control-protocol';
import { parsePromptTree, type PromptDesign } from '@prompt-studio/prompts';
import { describe, expect, it, vi } from 'vitest';
import { initializeSectionMetadata } from '../design/section-metadata';
import { WORKFLOW_PATTERNS } from '../design/workflow-patterns';
import { createWorkspacePrompt } from '../prompt-repo/workspace-document';
import { buildDesignCommands, type DesignCommandSurface } from './design-commands';

/**
 * The design commands' contract (roadmap #7): they read the Design panel's scopes, check a change exactly like the
 * panel's Save, save through the panel's save function, open the Design panel on the changed scope, and answer
 * with stable codes an agent can act on.
 */

const TEXT = [
  '<role>\nYou are the order-status assistant.\n</role>',
  '<tools>\nCall lookup_order with the order id in {{customer_message}}.\n</tools>',
  '<output>\nReply with JSON.\n</output>\n',
].join('\n\n');

const ORDER_REPLY = {
  kind: 'json',
  description: 'The order status reply.',
  jsonSchema: {
    type: 'object',
    required: ['order_id', 'status'],
    properties: { order_id: { type: 'string' }, status: { type: 'string', enum: ['shipped', 'pending'] } },
    additionalProperties: false,
  },
  examples: [{ order_id: '1042', status: 'shipped' }],
};

function design(): PromptDesign {
  const prompt = createWorkspacePrompt({
    id: 'order-status',
    title: 'Order status',
    configuration: '',
    tool: 'lookup_order',
    variable: 'customer_message',
  });
  return initializeSectionMetadata(prompt.design, TEXT);
}

function surface(overrides: Partial<DesignCommandSurface> = {}): DesignCommandSurface {
  return {
    loadedDocument: { rootId: 'order-status', text: TEXT },
    tree: parsePromptTree({ key: 'order-status', text: TEXT }),
    design: design(),
    confirmDiscard: vi.fn(() => true),
    saveDesign: vi.fn(async () => {}),
    showDesign: vi.fn(),
    validateWorkflow: vi.fn(async () => ({ valid: true as const })),
    ...overrides,
  };
}

async function codeOf(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return error instanceof ControlCommandError ? error.code : 'not a ControlCommandError';
  }
  return undefined;
}

describe('getDesign', () => {
  it('returns the whole prompt or one section, addressed by section id or tag', () => {
    // Given: the order-status prompt open with its design
    const commands = buildDesignCommands(surface());
    // When: the agent reads the prompt scope and the output section by id
    const prompt = commands.getDesign({ rootId: 'order-status' }) as Record<string, unknown>;
    const output = commands.getDesign({ rootId: 'order-status', sectionId: 'output' }) as Record<string, unknown>;
    // Then: both scopes carry input, workflow and output; the prompt scope lists tools, sections and readiness
    expect(prompt).toMatchObject({
      sectionId: null,
      tools: ['lookup_order'],
      input: { kind: 'free-text' },
      output: { kind: 'freeform' },
      sections: ['order-status.role', 'order-status.tools', 'order-status.output'],
      readiness: [],
    });
    expect(output).toMatchObject({ sectionId: 'order-status.output', workflow: expect.stringContaining('flowchart') });
  });

  it('names a missing design and an unknown section with stable codes', async () => {
    // Given: a prompt without a design, and the order-status prompt
    const none = buildDesignCommands(surface({ design: undefined }));
    const commands = buildDesignCommands(surface());
    // When / Then: no design is a failed command; an unknown section is a missing target
    expect(await codeOf(() => none.getDesign({ rootId: 'order-status' }))).toBe('command_failed');
    expect(() => none.getDesign({ rootId: 'order-status' })).toThrow('has no design');
    expect(await codeOf(() => commands.getDesign({ rootId: 'order-status', sectionId: 'nope' }))).toBe(
      'missing_target',
    );
  });
});

describe('setDesign', () => {
  it('saves a valid JSON output contract through the panel save and opens Design on that scope', async () => {
    // Given: the order-status prompt open
    const tab = surface();
    // When: the agent sets the prompt's output to the JSON reply contract
    const result = await buildDesignCommands(tab).setDesign({ rootId: 'order-status', output: ORDER_REPLY });
    // Then: the saved design has the contract and a new version, and the Design panel opens on the whole prompt
    const saved = vi.mocked(tab.saveDesign).mock.calls[0]![0];
    expect(saved.output).toEqual(ORDER_REPLY);
    expect(saved.version).toBe(tab.design!.version + 1);
    expect(tab.showDesign).toHaveBeenCalledWith(undefined);
    expect(result).toMatchObject({ sectionId: null, version: saved.version, output: ORDER_REPLY });
  });

  it("refuses an invalid change with the validator's messages and saves nothing", async () => {
    // Given: an example that breaks its own schema, and a workflow Mermaid cannot render
    const tab = surface({ validateWorkflow: vi.fn(async () => ({ valid: false as const, error: 'Parse error' })) });
    const commands = buildDesignCommands(tab);
    const badExample = { ...ORDER_REPLY, examples: [{ order_id: 7 }] };
    // When / Then: each is invalid input that names the problem
    await expect(commands.setDesign({ rootId: 'order-status', output: badExample })).rejects.toThrow(
      /Output example 1:/,
    );
    expect(await codeOf(() => commands.setDesign({ rootId: 'order-status', output: { kind: 'nope' } }))).toBe(
      'invalid_input',
    );
    await expect(commands.setDesign({ rootId: 'order-status', workflow: 'flowchart LR\n  A -->' })).rejects.toThrow(
      'Major workflow cannot render: Parse error',
    );
    expect(tab.saveDesign).not.toHaveBeenCalled();
  });

  it('changes nothing when the person keeps unsaved panel changes', async () => {
    // Given: the person declines to discard an open panel's draft
    const tab = surface({ confirmDiscard: vi.fn(() => false) });
    // When: the agent sets a section workflow
    const code = await codeOf(() =>
      buildDesignCommands(tab).setDesign({
        rootId: 'order-status',
        sectionId: 'tools',
        workflow: 'flowchart LR\n A-->B',
      }),
    );
    // Then: nothing is saved
    expect(code).toBe('command_failed');
    expect(tab.saveDesign).not.toHaveBeenCalled();
  });
});

describe('verifySample and workflow patterns', () => {
  it('checks a sample against the JSON output contract like Verify sample', () => {
    // Given: a design whose output is the JSON reply contract
    const base = design();
    const commands = buildDesignCommands(surface({ design: { ...base, output: ORDER_REPLY } as PromptDesign }));
    // When: a valid and an invalid model reply are checked
    const good = commands.verifySample({ rootId: 'order-status', sample: '{"order_id":"9","status":"pending"}' });
    const bad = commands.verifySample({ rootId: 'order-status', sample: '{"order_id":"9","status":"lost"}' }) as {
      valid: boolean;
      errors: string[];
    };
    // Then: the first matches; the second fails with the schema error
    expect(good).toMatchObject({ contract: 'output', valid: true, errors: [] });
    expect(bad.valid).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/status/);
  });

  it('reports a scope without a JSON contract instead of guessing', async () => {
    // Given / When / Then: the default free-text / freeform design has nothing to verify against
    expect(
      await codeOf(() => buildDesignCommands(surface()).verifySample({ rootId: 'order-status', sample: '{}' })),
    ).toBe('command_failed');
  });

  it('lists the panel catalog and applies a pattern as the workflow only', async () => {
    // Given: the order-status prompt open
    const tab = surface();
    const commands = buildDesignCommands(tab);
    // When: the agent lists patterns and applies "tools" to the tools section
    const patterns = (await commands.listWorkflowPatterns({})) as Array<{ id: string; graph: string }>;
    const result = await commands.applyWorkflowPattern({
      rootId: 'order-status',
      sectionId: 'tools',
      patternId: 'tools',
    });
    // Then: the catalog is the picker's, and only the section's workflow changed
    expect(patterns.map((pattern) => pattern.id)).toEqual(WORKFLOW_PATTERNS.map((pattern) => pattern.id));
    const saved = vi.mocked(tab.saveDesign).mock.calls[0]![0];
    const before = tab.design!.sectionDesigns.find((section) => section.sectionId === 'order-status.tools')!;
    const after = saved.sectionDesigns.find((section) => section.sectionId === 'order-status.tools')!;
    expect(after).toEqual({ ...before, workflow: WORKFLOW_PATTERNS.find((pattern) => pattern.id === 'tools')!.graph });
    expect(saved.workflow).toBe(tab.design!.workflow);
    expect(tab.showDesign).toHaveBeenCalledWith('order-status.tools');
    expect(result).toMatchObject({ patternId: 'tools', sectionId: 'order-status.tools' });
    expect(await codeOf(() => commands.applyWorkflowPattern({ rootId: 'order-status', patternId: 'x' }))).toBe(
      'missing_target',
    );
  });
});

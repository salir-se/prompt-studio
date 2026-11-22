// @vitest-environment node
// @module-tag pure
import { ControlCommandError } from '@prompt-studio/control-protocol';
import { parsePromptTree } from '@prompt-studio/prompts';
import { describe, expect, it, vi } from 'vitest';
import { buildSectionCommands, type SectionCommandSurface } from './section-commands';

/**
 * The section commands' contract (roadmap #6): they read the tree the outline shows, route every edit to the
 * canvas's structure operations by graph node id, and report stable error codes an agent can act on.
 */

const TEXT = [
  '<role>\nYou answer order-status questions.\n</role>',
  '<tools>\nCall lookup_order with {{order_id}}.\n<retry>\nRetry once.\n</retry>\n</tools>',
  '<output>\nReply with JSON.\n</output>',
].join('\n\n');

function surface(overrides: Partial<SectionCommandSurface> = {}): SectionCommandSurface {
  return {
    loadedDocument: { rootId: 'order-status', text: TEXT },
    tree: parsePromptTree({ key: 'order-status', text: TEXT }),
    confirmDiscard: vi.fn(() => true),
    structure: {
      addSection: vi.fn(() => ({ text: 'next', sectionId: 'examples' })),
      moveSection: vi.fn(() => true),
      removeSection: vi.fn(() => true),
      editSectionBody: vi.fn(() => 'next'),
    },
    ...overrides,
  };
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof ControlCommandError ? error.code : 'not a ControlCommandError';
  }
  return undefined;
}

describe('listSections / readSection', () => {
  it('lists sections in document order with nesting, delimiter and variables', () => {
    // Given: the order-status prompt open in the tab
    const commands = buildSectionCommands(surface());
    // When: the agent lists its sections
    const result = commands.listSections({ rootId: 'order-status' }) as {
      sections: Array<Record<string, unknown>>;
    };
    // Then: four sections, nested retry under tools, with the variable reported on tools
    expect(result.sections.map((section) => [section.id, section.depth, section.parentId, section.index])).toEqual([
      ['role', 1, null, 0],
      ['tools', 1, null, 1],
      ['tools/retry', 2, 'tools', 0],
      ['output', 1, null, 2],
    ]);
    expect(result.sections[1]).toMatchObject({
      delimiter: 'xml-tag',
      tag: 'tools',
      childIds: ['tools/retry'],
      variables: ['order_id'],
      order: 1,
    });
  });

  it("reads one section's own body without its sub-sections", () => {
    // Given / When: the agent reads the tools section
    const result = buildSectionCommands(surface()).readSection({ rootId: 'order-status', sectionId: 'tools' });
    // Then: the body stops before the retry sub-section
    expect(result).toMatchObject({ id: 'tools', body: 'Call lookup_order with {{order_id}}.\n' });
    // And: a nested section can be named by its xml tag as well as by its path id
    expect(buildSectionCommands(surface()).readSection({ rootId: 'order-status', sectionId: 'retry' })).toMatchObject({
      id: 'tools/retry',
      parentId: 'tools',
      body: 'Retry once.\n',
    });
  });

  it('reports actionable codes: no document open, another document open, unknown section', () => {
    // Given: three tabs in the wrong state
    const none = buildSectionCommands(surface({ loadedDocument: null, tree: null }));
    const other = buildSectionCommands(surface({ loadedDocument: { rootId: 'greeting', text: 'Hi' } }));
    const open = buildSectionCommands(surface());
    // When / Then: each failure names its cause with a stable code
    expect(codeOf(() => none.listSections({ rootId: 'order-status' }))).toBe('command_failed');
    expect(() => none.listSections({ rootId: 'order-status' })).toThrow('Open a document first');
    expect(codeOf(() => other.listSections({ rootId: 'order-status' }))).toBe('command_failed');
    expect(codeOf(() => open.readSection({ rootId: 'order-status', sectionId: 'missing' }))).toBe('missing_target');
    expect(() => open.readSection({ rootId: 'order-status', sectionId: 'missing' })).toThrow('run listSections');
  });
});

describe('section edits', () => {
  it('routes every edit to the structure operations by graph node id', () => {
    // Given: a tab with the order-status prompt
    const tab = surface();
    const commands = buildSectionCommands(tab);
    // When: the agent edits, inserts, moves and removes sections
    expect(commands.editSection({ rootId: 'order-status', sectionId: 'tools', body: 'B', message: 'm' })).toEqual({
      rootId: 'order-status',
      edited: 'tools',
    });
    expect(
      commands.insertSection({ rootId: 'order-status', sectionId: 'role', tag: 'examples', body: 'E' }),
    ).toMatchObject({ inserted: 'examples', position: 'after' });
    commands.insertSection({ rootId: 'order-status', sectionId: 'tools', tag: 'errors', position: 'firstChild' });
    commands.moveSection({ rootId: 'order-status', sectionId: 'output', direction: 'up' });
    commands.removeSection({ rootId: 'order-status', sectionId: 'tools/retry' });
    // Then: each reached the canvas's own operation with the section's graph node id, after the discard check
    expect(tab.structure.editSectionBody).toHaveBeenCalledWith('section:tools', 'B', 'm');
    expect(tab.structure.addSection).toHaveBeenCalledWith('section:role', 'after', 'examples', 'E', undefined);
    expect(tab.structure.addSection).toHaveBeenCalledWith(
      'section:tools',
      'firstChild',
      'errors',
      undefined,
      undefined,
    );
    expect(tab.structure.moveSection).toHaveBeenCalledWith('section:output', 'up');
    expect(tab.structure.removeSection).toHaveBeenCalledWith('section:tools/retry');
    expect(tab.confirmDiscard).toHaveBeenCalledTimes(5);
  });

  it('changes nothing when the person keeps unsaved panel changes', () => {
    // Given: the person declines to discard an open panel's draft
    const tab = surface({ confirmDiscard: vi.fn(() => false) });
    // When: the agent edits a section
    const code = codeOf(() =>
      buildSectionCommands(tab).editSection({ rootId: 'order-status', sectionId: 'role', body: 'x' }),
    );
    // Then: the command fails and no structure operation ran
    expect(code).toBe('command_failed');
    expect(tab.structure.editSectionBody).not.toHaveBeenCalled();
  });

  it('rejects a bad tag and reports a boundary move', () => {
    // Given: a tab whose move reports "already first"
    const tab = surface();
    vi.mocked(tab.structure.moveSection).mockReturnValue(false);
    const commands = buildSectionCommands(tab);
    // When / Then: a tag with a space is invalid input; an impossible move is a failed command naming the reason
    expect(codeOf(() => commands.insertSection({ rootId: 'order-status', sectionId: 'role', tag: 'two words' }))).toBe(
      'invalid_input',
    );
    expect(tab.structure.addSection).not.toHaveBeenCalled();
    expect(() => commands.moveSection({ rootId: 'order-status', sectionId: 'role', direction: 'up' })).toThrow(
      'already first',
    );
  });
});

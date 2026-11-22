// @module-tag pure
import { describe, expect, it } from 'vitest';
import { emptyProjectDefinitions } from '../prompt-repo/project-definitions';
import { readWorkspacePrompt } from '../prompt-repo/workspace-document';
import { buildAdoption, inspectAdoption } from './adopt-prompt';

const definitions = emptyProjectDefinitions('Test');
describe('adopt existing source', () => {
  it('preserves skill frontmatter and source while creating native sections, bindings and contracts', () => {
    const text =
      '---\nname: summary\ndescription: Summarize\n---\n# Summary\n## Instructions\nRead {{document}} and @references/rules.md.\n## Output\nReturn a summary.';
    const source = inspectAdoption(text, 'SKILL.md', []);
    expect(source.id).toBe('summary');
    expect(source.variables).toEqual(['document']);
    expect(source.sections.map((node) => node.title)).toEqual(['Instructions', 'Output']);
    const result = buildAdoption({
      source,
      definitions,
      variables: { document: { purpose: 'Source material', sample: 'Example' } },
      tools: [],
      input: 'A document',
      output: 'A summary',
      workflow: 'flowchart LR\n A[Read] --> B[Summarize]',
      attachments: [{ path: 'references/rules.md', text: 'Rules' }],
    });
    expect(result.documents.map((file) => file.path)).toEqual([
      'skills/summary/SKILL.md',
      'skills/summary/references/rules.md',
    ]);
    const stored = readWorkspacePrompt(result.documents[0].text)!;
    expect(stored.text).toBe(text);
    expect(stored.design.sectionDesigns).toHaveLength(2);
    expect(stored.design.verificationProfiles).toHaveLength(3);
    expect(stored.design.variables[0]).toMatchObject({ name: 'document', purpose: 'Source material' });
    expect(result.definitions.variables[0]).toEqual(stored.design.variables[0]);
  });
  it('rejects missing contracts, malformed tools and unsafe attachment paths', () => {
    const base = {
      source: inspectAdoption('# Task\nDo work.', 'task.md', []),
      definitions,
      variables: {},
      tools: [],
      input: 'Request',
      output: 'Result',
      workflow: 'flowchart LR\n A --> B',
      attachments: [],
    };
    expect(() => buildAdoption({ ...base, input: '' })).toThrow(/input/i);
    expect(() => buildAdoption({ ...base, tools: [{ name: 'fetch', description: 'Fetch', schema: '[]' }] })).toThrow(
      /schema/i,
    );
    expect(() => buildAdoption({ ...base, attachments: [{ path: '../secret.md', text: 'X' }] })).toThrow(/reference/i);
  });
  it('chooses a free ID, and retains an existing document identity and design', () => {
    expect(inspectAdoption('# Task\nDo work.', 'task.md', ['task']).id).toBe('task-2');
    const source = inspectAdoption('## Changed\nNew instructions', 'skills/original/SKILL.md', ['original'], {
      id: 'original',
      title: 'Original',
    });
    expect(source).toMatchObject({ id: 'original', title: 'Original', path: 'skills/original/SKILL.md' });
  });
});

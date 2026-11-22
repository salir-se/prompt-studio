// @module-tag pure
import { describe, expect, it } from 'vitest';
import { buildRootCatalog } from '../catalog/root-catalog';
import { createWorkspacePrompt, readWorkspacePrompt, workspaceFileForDesign } from './workspace-document';

describe('createWorkspacePrompt', () => {
  it('puts the tool, variable, and configuration on the design the editor loads', () => {
    const created = createWorkspacePrompt({
      id: 'account-research',
      title: 'Account Research',
      configuration: 'Outreach',
      tool: 'web_search',
      variable: 'company',
    });
    const loaded = readWorkspacePrompt(created.document.text);
    expect(created.design.tools).toEqual(['web_search']);
    expect(created.design.variables.map((variable) => [variable.name, variable.lifecycle, variable.sample])).toEqual([
      ['company', 'runtime', ''],
      ['configuration', 'configuration', 'Outreach'],
    ]);
    expect(loaded?.design).toEqual(created.design);
    expect(loaded?.text).toBe(created.text);
    expect(loaded?.configuration).toBe('Outreach');

    const catalog = buildRootCatalog(
      undefined,
      {
        catalog: {
          source: 'explicit',
          documents: [
            {
              id: 'account-research',
              title: 'Account Research',
              group: 'prompts',
              source: { kind: 'file', path: created.document.path },
            },
          ],
        },
      } as never,
      new Map([[created.document.path, created.document.text]]),
    );
    expect(catalog[0]?.loadability).toBe('constant');
    expect(catalog[0]?.design?.tools).toEqual(['web_search']);
    expect(catalog[0]?.design?.variables).toEqual(created.design.variables);
    expect(catalog[0]?.text).toBe(created.text);
  });
});

it('persists automatically initialized sections with inline variable details in the same file', () => {
  const created = createWorkspacePrompt({
    id: 'summary',
    title: 'Summary',
    configuration: 'Default',
    tool: '',
    variable: 'source',
    variableDefinition: {
      name: 'source',
      purpose: 'Source text',
      sample: 'A report',
      required: true,
      lifecycle: 'runtime',
      encoding: 'xml-text',
      presentation: 'placeholder',
    },
  });
  const text = `${created.text}\n<output>\nCite evidence.\n</output>\n`;
  const file = workspaceFileForDesign(created.design, text, created.configuration);
  const reopened = readWorkspacePrompt(file.text);
  expect(reopened?.text).toBe(text);
  expect(reopened?.design.sectionDesigns.map((section) => section.sectionId)).toEqual([
    'summary.mission',
    'summary.output',
  ]);
  expect(reopened?.design.variables[0]).toMatchObject({ name: 'source', purpose: 'Source text', sample: 'A report' });
  expect(workspaceFileForDesign(reopened?.design ?? created.design, text, created.configuration)).toEqual(file);
});

// @module-tag pure
import { describe, expect, it } from 'vitest';
import { exportDefinitions, mergeDefinitionImport, readDefinitionImport } from './definition-transfer';
import { emptyProjectDefinitions, type ProjectDefinitions } from './project-definitions';

describe('definition transfer', () => {
  it('round trips tools without changing variables or schema fields', () => {
    const project: ProjectDefinitions = {
      ...emptyProjectDefinitions('Demo'),
      tools: [
        {
          name: 'lookup',
          description: 'Lookup',
          inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } } },
        },
      ],
    };
    const imported = readDefinitionImport(
      exportDefinitions(project, 'tools'),
      'tools',
      emptyProjectDefinitions('Demo'),
    );
    expect(mergeDefinitionImport(emptyProjectDefinitions('Demo'), imported, 'tools', false)).toEqual(project);
  });
  it('rejects wrong collection envelopes and refuses secret-bearing exports', () => {
    const project = emptyProjectDefinitions('Demo');
    expect(() => readDefinitionImport('{"format":"prompt-studio-tools@1","tools":[]}', 'variables', project)).toThrow();
    expect(() =>
      exportDefinitions(
        {
          ...project,
          variables: [
            {
              name: 'token',
              purpose: 'Token',
              sample: 'secret',
              required: true,
              lifecycle: 'server-only',
              encoding: 'xml-text',
              presentation: 'redacted',
            },
          ],
        },
        'variables',
      ),
    ).toThrow('Remove the sample');
  });
});

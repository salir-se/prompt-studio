// @module-tag pure
import { describe, expect, it } from 'vitest';
import { emptyProjectDefinitions, validateProjectDefinitions } from './project-definitions';

describe('project definitions', () => {
  it('round trips authored variables and tool schemas, rejecting duplicates and secret samples atomically', () => {
    const project = {
      ...emptyProjectDefinitions('My project'),
      variables: [
        {
          name: 'company',
          purpose: 'Company to research',
          sample: 'Acme',
          required: true,
          lifecycle: 'runtime',
          encoding: 'xml-text',
          presentation: 'placeholder',
        },
      ],
      tools: [
        {
          name: 'search',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
    };
    expect(validateProjectDefinitions(JSON.parse(JSON.stringify(project)))).toEqual(project);
    expect(() => validateProjectDefinitions({ ...project, tools: [...project.tools, ...project.tools] })).toThrow(
      /duplicate/i,
    );
    expect(() =>
      validateProjectDefinitions({
        ...project,
        variables: [{ ...project.variables[0], lifecycle: 'server-only', sample: 'secret' }],
      }),
    ).toThrow(/sample/i);
    expect(() =>
      validateProjectDefinitions({ ...project, tools: [{ ...project.tools[0], inputSchema: [] }] }),
    ).toThrow();
    expect(project.variables[0].sample).toBe('Acme');
  });
});

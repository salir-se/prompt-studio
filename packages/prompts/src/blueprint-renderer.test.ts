// @module-tag pure
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { renderPromptBlueprint, renderPromptBlueprintMermaid } from './blueprint-renderer';
import type { PromptBlueprint, PromptConfiguration, PromptSectionVersion } from './composition-contracts';

const blueprint: PromptBlueprint = {
  id: 'test.prompt',
  version: 1,
  maxDepth: 3,
  root: {
    id: 'root',
    tag: 'test_root',
    children: [{ id: 'child', tag: 'test_child', children: [] }],
  },
};

const configuration: PromptConfiguration = {
  id: 'test.configuration',
  version: 1,
  blueprint: { id: blueprint.id, version: blueprint.version },
  sectionVersions: {
    root: { id: 'root.v1', version: 1 },
    child: { id: 'child.v1', version: 1 },
  },
};

const sections: readonly PromptSectionVersion[] = [
  {
    id: 'root.v1',
    sectionId: 'root',
    version: 1,
    heading: 'Root',
    template: 'Hello {{name}}.',
    variables: [
      {
        name: 'name',
        schema: type('string > 0'),
        lifecycle: 'configuration',
        encoding: 'xml-text',
        presentation: 'placeholder',
      },
    ],
  },
  {
    id: 'child.v1',
    sectionId: 'child',
    version: 1,
    heading: 'Child',
    template: 'Keep the child instruction.',
    variables: [],
  },
];

describe('renderPromptBlueprint', () => {
  it('renders configuration-selected sections in tree order with generated headings and tags', () => {
    expect(
      renderPromptBlueprint({ blueprint, configuration, sectionVersions: sections, values: { name: '<Salir>' } }),
    ).toEqual({
      sectionIds: ['root', 'child'],
      systemPrompt: [
        '# Root',
        '<test_root>',
        'Hello &lt;Salir&gt;.',
        '',
        '## Child',
        '<test_child>',
        'Keep the child instruction.',
        '</test_child>',
        '</test_root>',
      ].join('\n'),
    });
  });

  it('rejects a configuration that omits a structural section', () => {
    const invalid = { ...configuration, sectionVersions: { root: configuration.sectionVersions.root } };
    expect(() =>
      renderPromptBlueprint({
        blueprint,
        configuration: invalid,
        sectionVersions: sections,
        values: { name: 'Salir' },
      }),
    ).toThrow(/exactly match blueprint sections/i);
  });

  it('rejects author text that attempts to replace generated structure', () => {
    const invalidSections = sections.map((section) =>
      section.sectionId === 'child' ? { ...section, template: '# Replaced heading' } : section,
    );
    expect(() =>
      renderPromptBlueprint({ blueprint, configuration, sectionVersions: invalidSections, values: { name: 'Salir' } }),
    ).toThrow(/must not contain markdown headings/i);
  });
});

describe('renderPromptBlueprintMermaid', () => {
  it('represents the same section order and depth as the executable blueprint', () => {
    expect(renderPromptBlueprintMermaid(blueprint, sections)).toBe(
      [
        'flowchart TD',
        '  section0["H1 Root<br/>test_root"]',
        '  section1["H2 Child<br/>test_child"]',
        '  section0 --> section1',
      ].join('\n'),
    );
  });
});

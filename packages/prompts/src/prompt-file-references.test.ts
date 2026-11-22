// @module-tag pure
/** Source dependency recognition. */
import { describe, expect, it } from 'vitest';
import { extractPromptFileReferences } from './prompt-file-references';
import { toGraphModel } from './tree/graph-model';
import { parsePromptTree } from './tree/parse-tree';

describe('prompt file references', () => {
  it('recognizes explicit loads, Windows paths, and Markdown references without changing source', () => {
    expect(
      extractPromptFileReferences(String.raw`Read @path/to/file and @"docs/my guide.md".
Also path\to\windows\file.txt, C:\project\notes.md and [policy](references/policy.md).`),
    ).toEqual([
      { path: 'path/to/file', loadBeforeBody: true },
      { path: 'docs/my guide.md', loadBeforeBody: true },
      { path: 'path/to/windows/file.txt', loadBeforeBody: false },
      { path: 'C:/project/notes.md', loadBeforeBody: false },
      { path: 'references/policy.md', loadBeforeBody: false },
    ]);
  });

  it('excludes email, URLs, fenced examples and frontmatter; deduplicates normalized paths', () => {
    expect(
      extractPromptFileReferences(
        '---\nexample: @hidden.md\n---\nEmail user@example.com. https://site.test/a\\b\n```\n@fake.md\n```\n@docs/a.md docs\\a.md',
      ),
    ).toEqual([{ path: 'docs/a.md', loadBeforeBody: true }]);
  });

  it('projects one shared file node linked to each section, including preamble loads', () => {
    const text = '@shared/rules.md\n# Task\nRead @shared/rules.md\n## Output\nUse shared\\rules.md';
    const graph = toGraphModel(parsePromptTree({ key: 'task', text, toolNames: [] }));
    expect(graph.nodes.filter((node) => node.kind === 'file')).toEqual([
      {
        id: 'file:shared/rules.md',
        kind: 'file',
        label: 'shared/rules.md',
        data: { kind: 'file', path: 'shared/rules.md', loadBeforeBody: true },
      },
    ]);
    expect(graph.edges.filter((edge) => edge.kind === 'references').map((edge) => [edge.source, edge.target])).toEqual([
      ['section:task', 'file:shared/rules.md'],
      ['section:task/output', 'file:shared/rules.md'],
      ['root:task', 'file:shared/rules.md'],
    ]);
    expect(graph.nodes[0]?.data).toMatchObject({ tree: { text } });
  });
});

it('recognizes Windows network paths without treating web URLs as files', () => {
  expect(
    extractPromptFileReferences(
      String.raw`Read \\server\share\file.txt and @\\server\share\file.txt. See [web](https://example.com/file.txt).`,
    ),
  ).toEqual([{ path: '//server/share/file.txt', loadBeforeBody: true }]);
});

it('#2525: recognizes an @file between closed XML sections as a root dependency', () => {
  const text = '<mission>\nTask\n</mission>\n@folder/file.md\n<output>\nResult\n</output>';
  const graph = toGraphModel(parsePromptTree({ key: 'task', text, toolNames: [] }));
  expect(graph.nodes.find((node) => node.id === 'file:folder/file.md')?.data).toEqual({
    kind: 'file',
    path: 'folder/file.md',
    loadBeforeBody: true,
  });
  expect(graph.edges.find((edge) => edge.target === 'file:folder/file.md')).toMatchObject({
    source: 'root:task',
    kind: 'references',
    label: 'Load before prompt',
  });
});

it('#2525: includes references between/after XML sections and parent prose around children', () => {
  const text =
    '@before.md\n<mission>\nRead folder\\file.md\n<child>\nUse @child.md\n</child>\n@folder/file.md\n</mission>\n@folder/file.md\n<output>\nResult\n</output>\n@after.md';
  const graph = toGraphModel(parsePromptTree({ key: 'task', text, toolNames: [] }));
  expect(
    graph.nodes
      .filter((node) => node.kind === 'file')
      .map((node) => node.id)
      .sort(),
  ).toEqual(['file:after.md', 'file:before.md', 'file:child.md', 'file:folder/file.md']);
  const edges = graph.edges.filter((edge) => edge.kind === 'references');
  expect(edges.map((edge) => [edge.source, edge.target]).sort()).toEqual([
    ['root:task', 'file:after.md'],
    ['root:task', 'file:before.md'],
    ['root:task', 'file:folder/file.md'],
    ['section:mission', 'file:folder/file.md'],
    ['section:mission/child', 'file:child.md'],
  ]);
  expect(edges.find((edge) => edge.source === 'section:mission')?.label).toBe('Load before prompt');
  expect(graph.nodes.find((node) => node.id === 'file:folder/file.md')?.data).toMatchObject({ loadBeforeBody: true });
  expect(graph.nodes[0]?.data).toMatchObject({ tree: { text } });
});

it('#2525: deduplicates unscoped paths without discovering masked examples', () => {
  const text =
    '---\nexample: @frontmatter.md\n---\n@shared.md\n<mission>\nTask\n</mission>\n```md\n@hidden.md\n```\n@shared.md\n<output>\nResult\n</output>\n@shared.md';
  const graph = toGraphModel(parsePromptTree({ key: 'task', text, toolNames: [] }));
  expect(graph.nodes.filter((node) => node.kind === 'file').map((node) => node.id)).toEqual(['file:shared.md']);
  expect(graph.edges.filter((edge) => edge.kind === 'references')).toHaveLength(1);
});

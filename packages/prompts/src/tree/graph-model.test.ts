// @module-tag pure
import { describe, expect, it } from 'vitest';
import { toGraphModel } from './graph-model';
import type { PromptTree, PromptTreeNode } from './types';

// ── Fixture builders ─────────────────────────────────────────────────────────
//
// The parser (`parse-tree.ts`) is being written concurrently by another task
// and must not be imported here (see task brief) — every `PromptTree` fixture
// below is a hand-built object literal typed against the frozen contract in
// `./types`. These builders exist only to keep the fixtures in this file
// readable; they are not part of the module under test.

function makeNode(overrides: Partial<PromptTreeNode> & { id: string; title: string }): PromptTreeNode {
  return {
    delimiter: 'caps-label',
    depth: 1,
    text: '',
    range: { start: 0, end: 0 },
    variables: [],
    toolMentions: [],
    children: [],
    ...overrides,
  };
}

function makeTree(overrides: Partial<PromptTree> & { key: string }): PromptTree {
  return {
    text: '',
    maxDepth: 0,
    children: [],
    tagClassifications: [],
    diagnostics: [],
    ...overrides,
  };
}

describe('toGraphModel', () => {
  it('projects an empty tree into exactly one root node and zero edges', () => {
    const tree = makeTree({ key: 'scout' });

    const model = toGraphModel(tree);

    expect(model.nodes).toHaveLength(1);
    expect(model.edges).toHaveLength(0);
    const [rootNode] = model.nodes;
    expect(rootNode.kind).toBe('root');
    expect(rootNode.label).toBe('scout');
    expect(rootNode.parentId).toBeUndefined();
    expect(rootNode.data).toEqual({ kind: 'root', tree });
  });

  it('projects a single top-level section with a contains edge from root', () => {
    const mission = makeNode({ id: 'mission', title: 'YOUR MISSION' });
    const tree = makeTree({ key: 'scout', children: [mission] });

    const model = toGraphModel(tree);

    expect(model.nodes).toHaveLength(2);
    const rootNode = model.nodes.find((n) => n.kind === 'root');
    const sectionNode = model.nodes.find((n) => n.kind === 'section');
    expect(rootNode).toBeDefined();
    expect(sectionNode).toBeDefined();
    expect(sectionNode?.label).toBe('YOUR MISSION');
    expect(sectionNode?.parentId).toBe(rootNode?.id);
    expect(sectionNode?.data).toEqual({ kind: 'section', node: mission });

    expect(model.edges).toHaveLength(1);
    const [edge] = model.edges;
    expect(edge.kind).toBe('contains');
    expect(edge.source).toBe(rootNode?.id);
    expect(edge.target).toBe(sectionNode?.id);
    expect(edge.label).toBeUndefined();
  });

  it('projects nested sections depth-first pre-order with correct contains edges and parentIds', () => {
    const grandchild = makeNode({ id: 'gc', title: 'Grandchild', depth: 3 });
    const child = makeNode({ id: 'c', title: 'Child', depth: 2, children: [grandchild] });
    const sibling = makeNode({ id: 'sib', title: 'Sibling', depth: 1 });
    const parent = makeNode({ id: 'p', title: 'Parent', depth: 1, children: [child] });
    const tree = makeTree({ key: 'researcher', children: [parent, sibling] });

    const model = toGraphModel(tree);

    const sectionNodes = model.nodes.filter((n) => n.kind === 'section');
    // Source order is depth-first pre-order: parent, then its descendant
    // (child, grandchild), before the next top-level sibling.
    expect(sectionNodes.map((n) => n.label)).toEqual(['Parent', 'Child', 'Grandchild', 'Sibling']);

    const rootNode = model.nodes.find((n) => n.kind === 'root');
    const byLabel = (label: string) => sectionNodes.find((n) => n.label === label);

    expect(byLabel('Parent')?.parentId).toBe(rootNode?.id);
    expect(byLabel('Sibling')?.parentId).toBe(rootNode?.id);
    expect(byLabel('Child')?.parentId).toBe(byLabel('Parent')?.id);
    expect(byLabel('Grandchild')?.parentId).toBe(byLabel('Child')?.id);

    const containsEdges = model.edges.filter((e) => e.kind === 'contains');
    expect(containsEdges).toHaveLength(4); // root->parent, root->sibling, parent->child, child->grandchild
    const edgeExists = (source?: string, target?: string) =>
      containsEdges.some((e) => e.source === source && e.target === target);
    expect(edgeExists(rootNode?.id, byLabel('Parent')?.id)).toBe(true);
    expect(edgeExists(rootNode?.id, byLabel('Sibling')?.id)).toBe(true);
    expect(edgeExists(byLabel('Parent')?.id, byLabel('Child')?.id)).toBe(true);
    expect(edgeExists(byLabel('Child')?.id, byLabel('Grandchild')?.id)).toBe(true);
    // Structural nesting is already named by the child's own title/card — see
    // `PromptGraphEdge.label`'s doc — so no `'contains'` edge carries a label.
    expect(containsEdges.every((e) => e.label === undefined)).toBe(true);
  });

  it('dedupes a variable shared by two sections into one node with two declares edges', () => {
    const sectionA = makeNode({ id: 'a', title: 'Section A', variables: ['companyName'] });
    const sectionB = makeNode({ id: 'b', title: 'Section B', variables: ['companyName'] });
    const tree = makeTree({ key: 'closer', children: [sectionA, sectionB] });

    const model = toGraphModel(tree);

    const variableNodes = model.nodes.filter((n) => n.kind === 'variable');
    expect(variableNodes).toHaveLength(1);
    expect(variableNodes[0].data).toEqual({ kind: 'variable', name: 'companyName' });
    expect(variableNodes[0].parentId).toBeUndefined();

    const declaresEdges = model.edges.filter((e) => e.kind === 'declares' && e.target === variableNodes[0].id);
    expect(declaresEdges).toHaveLength(2);
    const sectionIdOf = (title: string) => model.nodes.find((n) => n.kind === 'section' && n.label === title)?.id;
    const sources = declaresEdges.map((e) => e.source).sort();
    expect(sources).toEqual([sectionIdOf('Section A'), sectionIdOf('Section B')].sort());
    // A variable declares edge's label is the `{{name}}` form — braces
    // included, matching prompt source syntax and the violet variable chip.
    expect(declaresEdges.every((e) => e.label === '{{companyName}}')).toBe(true);
  });

  it('dedupes a tool mentioned by two sections into one node with two declares edges', () => {
    const sectionA = makeNode({ id: 'a', title: 'Section A', toolMentions: ['web_search'] });
    const sectionB = makeNode({ id: 'b', title: 'Section B', toolMentions: ['web_search'] });
    const tree = makeTree({ key: 'closer', children: [sectionA, sectionB] });

    const model = toGraphModel(tree);

    const toolNodes = model.nodes.filter((n) => n.kind === 'tool');
    expect(toolNodes).toHaveLength(1);
    expect(toolNodes[0].data).toEqual({ kind: 'tool', name: 'web_search' });
    expect(toolNodes[0].parentId).toBeUndefined();

    const declaresEdges = model.edges.filter((e) => e.kind === 'declares' && e.target === toolNodes[0].id);
    expect(declaresEdges).toHaveLength(2);
    // A tool declares edge's label is the bare tool name — no braces, unlike a variable edge.
    expect(declaresEdges.every((e) => e.label === 'web_search')).toBe(true);
  });

  it('dedupes a repeated variable within the SAME section into one node with one declares edge', () => {
    // A node's own `variables` list could plausibly contain a name twice if
    // the {{placeholder}} occurs more than once in the section's text. The
    // projection must not emit two edges with the same (source, target) pair.
    const section = makeNode({ id: 'a', title: 'Section A', variables: ['x', 'x'] });
    const tree = makeTree({ key: 'closer', children: [section] });

    const model = toGraphModel(tree);

    expect(model.nodes.filter((n) => n.kind === 'variable')).toHaveLength(1);
    expect(model.edges.filter((e) => e.kind === 'declares')).toHaveLength(1);
  });

  it('does not collide a section id with a same-named variable', () => {
    // A section's PromptTreeNode.id and a {{variable}} name can legitimately
    // share the same literal string ("foo"). Node ids are prefixed by kind
    // specifically so this never collapses into one node or a lost edge.
    const section = makeNode({ id: 'foo', title: 'Foo Section', variables: ['foo'] });
    const tree = makeTree({ key: 'critic', children: [section] });

    const model = toGraphModel(tree);

    const sectionNode = model.nodes.find((n) => n.kind === 'section');
    const variableNode = model.nodes.find((n) => n.kind === 'variable');
    expect(sectionNode).toBeDefined();
    expect(variableNode).toBeDefined();
    expect(sectionNode?.id).not.toBe(variableNode?.id);

    const allIds = model.nodes.map((n) => n.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('is deterministic: two calls on the same tree produce deeply-equal output', () => {
    const child = makeNode({ id: 'c', title: 'Child', variables: ['x'], toolMentions: ['web_search'] });
    const parent = makeNode({
      id: 'p',
      title: 'Parent',
      children: [child],
      variables: ['x'],
      toolMentions: ['web_search'],
    });
    const tree = makeTree({ key: 'researcher', children: [parent] });

    const first = toGraphModel(tree);
    const second = toGraphModel(tree);

    expect(second).toEqual(first);
  });

  it('emits only edges whose source and target reference ids present in nodes', () => {
    const child = makeNode({ id: 'c', title: 'Child', variables: ['x'], toolMentions: ['t'] });
    const parent = makeNode({ id: 'p', title: 'Parent', children: [child], variables: ['x'] });
    const sibling = makeNode({ id: 's', title: 'Sibling', toolMentions: ['t'] });
    const tree = makeTree({ key: 'scout', children: [parent, sibling] });

    const model = toGraphModel(tree);

    const nodeIds = new Set(model.nodes.map((n) => n.id));
    for (const edge of model.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }

    const edgeIds = model.edges.map((e) => e.id);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
  });

  it('gives root no parentId and every root-level section root as its parent', () => {
    const a = makeNode({ id: 'a', title: 'A' });
    const b = makeNode({ id: 'b', title: 'B' });
    const tree = makeTree({ key: 'scout', children: [a, b] });

    const model = toGraphModel(tree);

    const rootNode = model.nodes.find((n) => n.kind === 'root');
    expect(rootNode?.parentId).toBeUndefined();
    const sectionParents = model.nodes.filter((n) => n.kind === 'section').map((n) => n.parentId);
    expect(sectionParents).toEqual([rootNode?.id, rootNode?.id]);
  });
});

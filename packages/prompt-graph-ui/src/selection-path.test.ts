// @module-tag dom
/**
 * BDD tests for `selectionPath` — a pure, deterministic computation of the
 * ancestor path from a selected `PromptGraphModel` node back to the root(s)
 * it descends from. No React, no xyflow, no DOM: every assertion here is
 * about the shape of the returned `SelectionPath` (`nodeIds`/`edgeIds` sets).
 *
 * Behaviour contracts:
 *  - `undefined` or unknown selected id → empty sets, never throws.
 *  - A `'root'`/`'section'` node's path walks its `parentId` chain up to (and
 *    including) the root, including the connecting `'contains'` edge for
 *    each hop when one exists in the model.
 *  - A `'variable'`/`'tool'` node (no `parentId`) has no ancestor chain of
 *    its own — its path is every inbound `'declares'` edge plus each
 *    declaring section's own ancestor chain, deduped via the sets.
 *  - Defensive against a `parentId` cycle, a dangling `parentId`, and a
 *    missing `'contains'` edge — none of these may throw, and each still
 *    produces deterministic output.
 */

import type { PromptGraphEdge, PromptGraphModel, PromptGraphNode } from '@prompt-studio/prompts';
import { parsePromptTree, toGraphModel } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import { selectionPath } from './selection-path';

// ── Fixture builders ─────────────────────────────────────────────────────────

function makeNode(
  overrides: Partial<PromptGraphNode> & { id: string; kind: PromptGraphNode['kind'] },
): PromptGraphNode {
  const label = overrides.label ?? overrides.id;
  return {
    label,
    data:
      overrides.kind === 'root'
        ? {
            kind: 'root',
            tree: { key: label, text: '', maxDepth: 0, children: [], tagClassifications: [], diagnostics: [] },
          }
        : overrides.kind === 'section'
          ? {
              kind: 'section',
              node: {
                id: overrides.id,
                title: label,
                delimiter: 'caps-label',
                depth: 1,
                text: '',
                range: { start: 0, end: 0 },
                variables: [],
                toolMentions: [],
                children: [],
              },
            }
          : { kind: overrides.kind, name: label },
    ...overrides,
  };
}

function makeEdge(
  overrides: Partial<PromptGraphEdge> & { id: string; source: string; target: string },
): PromptGraphEdge {
  return { kind: 'contains', ...overrides };
}

function makeModel(nodes: PromptGraphNode[], edges: PromptGraphEdge[] = []): PromptGraphModel {
  return { nodes, edges };
}

describe('selectionPath', () => {
  it('returns empty sets when selectedNodeId is undefined', () => {
    const model = makeModel([makeNode({ id: 'root:scout', kind: 'root' })]);

    const result = selectionPath(model, undefined);

    expect(result.nodeIds.size).toBe(0);
    expect(result.edgeIds.size).toBe(0);
  });

  it('returns empty sets when selectedNodeId is not present in the model', () => {
    const model = makeModel([makeNode({ id: 'root:scout', kind: 'root' })]);

    const result = selectionPath(model, 'section:does-not-exist');

    expect(result.nodeIds.size).toBe(0);
    expect(result.edgeIds.size).toBe(0);
  });

  it('returns just itself when the root node is selected', () => {
    const model = makeModel([makeNode({ id: 'root:scout', kind: 'root' })]);

    const result = selectionPath(model, 'root:scout');

    expect(result.nodeIds).toEqual(new Set(['root:scout']));
    expect(result.edgeIds.size).toBe(0);
  });

  it('includes the node, the root, and the connecting contains edge for a depth-1 section', () => {
    const model = makeModel(
      [
        makeNode({ id: 'root:scout', kind: 'root' }),
        makeNode({ id: 'section:mission', kind: 'section', parentId: 'root:scout' }),
      ],
      [makeEdge({ id: 'edge:root->mission', source: 'root:scout', target: 'section:mission', kind: 'contains' })],
    );

    const result = selectionPath(model, 'section:mission');

    expect(result.nodeIds).toEqual(new Set(['section:mission', 'root:scout']));
    expect(result.edgeIds).toEqual(new Set(['edge:root->mission']));
  });

  it('includes every intermediate node and edge (and nothing else) for a depth-3 chain', () => {
    const model = makeModel(
      [
        makeNode({ id: 'root:scout', kind: 'root' }),
        makeNode({ id: 'section:parent', kind: 'section', parentId: 'root:scout' }),
        makeNode({ id: 'section:child', kind: 'section', parentId: 'section:parent' }),
        makeNode({ id: 'section:grandchild', kind: 'section', parentId: 'section:child' }),
        makeNode({ id: 'section:unrelated', kind: 'section', parentId: 'root:scout' }),
      ],
      [
        makeEdge({ id: 'edge:root->parent', source: 'root:scout', target: 'section:parent' }),
        makeEdge({ id: 'edge:parent->child', source: 'section:parent', target: 'section:child' }),
        makeEdge({ id: 'edge:child->grandchild', source: 'section:child', target: 'section:grandchild' }),
        makeEdge({ id: 'edge:root->unrelated', source: 'root:scout', target: 'section:unrelated' }),
      ],
    );

    const result = selectionPath(model, 'section:grandchild');

    expect(result.nodeIds).toEqual(new Set(['section:grandchild', 'section:child', 'section:parent', 'root:scout']));
    expect(result.edgeIds).toEqual(new Set(['edge:child->grandchild', 'edge:parent->child', 'edge:root->parent']));
  });

  it('includes both declares edges and both declaring sections full ancestor chains for a shared variable, deduping common ancestors', () => {
    const model = makeModel(
      [
        makeNode({ id: 'root:scout', kind: 'root' }),
        makeNode({ id: 'section:one', kind: 'section', parentId: 'root:scout' }),
        makeNode({ id: 'section:two', kind: 'section', parentId: 'root:scout' }),
        makeNode({ id: 'variable:name', kind: 'variable' }),
      ],
      [
        makeEdge({ id: 'edge:root->one', source: 'root:scout', target: 'section:one' }),
        makeEdge({ id: 'edge:root->two', source: 'root:scout', target: 'section:two' }),
        makeEdge({ id: 'edge:one->name', source: 'section:one', target: 'variable:name', kind: 'declares' }),
        makeEdge({ id: 'edge:two->name', source: 'section:two', target: 'variable:name', kind: 'declares' }),
      ],
    );

    const result = selectionPath(model, 'variable:name');

    expect(result.nodeIds).toEqual(new Set(['variable:name', 'section:one', 'section:two', 'root:scout']));
    expect(result.edgeIds).toEqual(new Set(['edge:one->name', 'edge:two->name', 'edge:root->one', 'edge:root->two']));
  });

  it('behaves the same shape for a tool node as for a variable node', () => {
    const model = makeModel(
      [
        makeNode({ id: 'root:scout', kind: 'root' }),
        makeNode({ id: 'section:one', kind: 'section', parentId: 'root:scout' }),
        makeNode({ id: 'tool:web_search', kind: 'tool' }),
      ],
      [
        makeEdge({ id: 'edge:root->one', source: 'root:scout', target: 'section:one' }),
        makeEdge({ id: 'edge:one->tool', source: 'section:one', target: 'tool:web_search', kind: 'declares' }),
      ],
    );

    const result = selectionPath(model, 'tool:web_search');

    expect(result.nodeIds).toEqual(new Set(['tool:web_search', 'section:one', 'root:scout']));
    expect(result.edgeIds).toEqual(new Set(['edge:one->tool', 'edge:root->one']));
  });

  it('terminates deterministically on a parentId cycle instead of hanging', () => {
    const model = makeModel([
      makeNode({ id: 'section:a', kind: 'section', parentId: 'section:b' }),
      makeNode({ id: 'section:b', kind: 'section', parentId: 'section:a' }),
    ]);

    const run = () => selectionPath(model, 'section:a');

    expect(run).not.toThrow();
    const result = run();
    expect(result.nodeIds).toEqual(new Set(['section:a', 'section:b']));

    // Re-running on the same model must not change the resolution.
    const again = selectionPath(model, 'section:a');
    expect(Array.from(again.nodeIds)).toEqual(Array.from(result.nodeIds));
    expect(Array.from(again.edgeIds)).toEqual(Array.from(result.edgeIds));
  });

  it('terminates deterministically on a self-referencing parentId', () => {
    const model = makeModel([makeNode({ id: 'section:self', kind: 'section', parentId: 'section:self' })]);

    const run = () => selectionPath(model, 'section:self');

    expect(run).not.toThrow();
    expect(run().nodeIds).toEqual(new Set(['section:self']));
  });

  it('ends the walk at the last real node when parentId is dangling', () => {
    const model = makeModel([makeNode({ id: 'section:orphan', kind: 'section', parentId: 'section:does-not-exist' })]);

    const result = selectionPath(model, 'section:orphan');

    expect(result.nodeIds).toEqual(new Set(['section:orphan']));
    expect(result.edgeIds.size).toBe(0);
  });

  it('includes node ids anyway when a contains edge is missing from the model (malformed input)', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'section:mission', kind: 'section', parentId: 'root:scout' }),
    ]);
    // No edges at all — the contains edge is missing.

    const result = selectionPath(model, 'section:mission');

    expect(result.nodeIds).toEqual(new Set(['section:mission', 'root:scout']));
    expect(result.edgeIds.size).toBe(0);
  });

  it('is deterministic: identical input always yields deeply-equal output', () => {
    const model = makeModel(
      [
        makeNode({ id: 'root:scout', kind: 'root' }),
        makeNode({ id: 'section:parent', kind: 'section', parentId: 'root:scout' }),
        makeNode({ id: 'section:child', kind: 'section', parentId: 'section:parent' }),
        makeNode({ id: 'variable:name', kind: 'variable' }),
      ],
      [
        makeEdge({ id: 'edge:root->parent', source: 'root:scout', target: 'section:parent' }),
        makeEdge({ id: 'edge:parent->child', source: 'section:parent', target: 'section:child' }),
        makeEdge({ id: 'edge:child->name', source: 'section:child', target: 'variable:name', kind: 'declares' }),
      ],
    );

    const first = selectionPath(model, 'variable:name');
    const second = selectionPath(model, 'variable:name');

    expect(Array.from(first.nodeIds)).toEqual(Array.from(second.nodeIds));
    expect(Array.from(first.edgeIds)).toEqual(Array.from(second.edgeIds));
  });
});

it('highlights file references through each referencing section to the root', () => {
  const graph = toGraphModel(
    parsePromptTree({ key: 'task', text: '@rules.md\n## Task\nRead @rules.md.', toolNames: [] }),
  );
  const result = selectionPath(graph, 'file:rules.md');
  expect([...result.nodeIds]).toEqual(['file:rules.md', 'section:task', 'root:task']);
  expect(result.edgeIds.size).toBe(3);
});

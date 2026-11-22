// @module-tag dom
/**
 * BDD tests for `layoutGraph` — a pure, deterministic layered/tree layout over
 * a `PromptGraphModel`. No React, no xyflow, no DOM: every assertion here is
 * about the shape of the returned `Map<string, LayoutPosition>`.
 *
 * Behaviour contracts:
 *  - Deterministic: identical input always yields identical output.
 *  - Root/section columns are assigned by walking the `parentId` chain
 *    (root at depth 0), siblings within a column stack vertically at a fixed
 *    spacing, in stable (input) order.
 *  - `variable`/`tool` nodes (no `parentId`) share one dedicated column to
 *    the right of the deepest section column, stacked in stable order.
 *  - Defensive against an empty model, a dangling `parentId` reference, and a
 *    parentId cycle — none of these may throw or hang, and each must still
 *    produce deterministic output.
 */

import type { PromptGraphEdge, PromptGraphModel, PromptGraphNode } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import {
  LAYOUT_COLLAPSED_CARD_HEIGHT,
  LAYOUT_COLLAPSED_ROW_HEIGHT,
  LAYOUT_COLUMN_WIDTH,
  LAYOUT_ROW_HEIGHT,
  layoutGraph,
  referenceLabelCenter,
} from './layout';

it('#2488: a collapsed section reserves only a single control row plus a separate layout gutter', () => {
  expect(LAYOUT_COLLAPSED_CARD_HEIGHT).toBeLessThanOrEqual(56);
  expect(LAYOUT_COLLAPSED_ROW_HEIGHT - LAYOUT_COLLAPSED_CARD_HEIGHT).toBe(40);
});

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

function makeModel(nodes: PromptGraphNode[], edges: PromptGraphEdge[] = []): PromptGraphModel {
  return { nodes, edges };
}

describe('#2498: connection label clearance', () => {
  const edge = {
    id: 'declares:mission->document',
    source: 'section:mission',
    target: 'variable:document',
    kind: 'declares',
    label: '{{document}}',
  } as const;
  const model = makeModel(
    [
      makeNode({ id: 'root:prompt', kind: 'root' }),
      makeNode({ id: 'section:mission', kind: 'section', parentId: 'root:prompt' }),
      makeNode({ id: 'variable:document', kind: 'variable' }),
    ],
    [edge],
  );
  it.each([false, true])('reserves measured label width and 16px on both sides (collapsed: %s)', (collapsed) => {
    const labelWidth = 81.5;
    const positions = layoutGraph(model, collapsed ? new Set([edge.source]) : undefined, {
      edgeLabelWidths: new Map([[edge.id, labelWidth]]),
    });
    const gap = positions.get(edge.target)!.x - positions.get(edge.source)!.x - 360;
    expect(gap).toBeGreaterThanOrEqual(labelWidth + 2 * 16);
    expect(positions.get(edge.source)!.x).toBe(LAYOUT_COLUMN_WIDTH);
  });
  it('keeps labels after every section column when a reference skips nested levels', () => {
    const nested = makeModel(
      [...model.nodes, makeNode({ id: 'section:child', kind: 'section', parentId: edge.source })],
      [edge],
    );
    const measurements = { edgeLabelWidths: new Map([[edge.id, 81.5]]) };
    const positions = layoutGraph(nested, undefined, measurements);
    const center = referenceLabelCenter(nested, positions)!;
    const rightmostSection = positions.get('section:child')!.x + 360;
    expect(center - 81.5 / 2 - rightmostSection).toBeGreaterThanOrEqual(16);
    expect(positions.get(edge.target)!.x - center - 81.5 / 2).toBeGreaterThanOrEqual(16);
  });
  it('keeps resized section rows clear, while collapse still uses the compact height', () => {
    const rows = makeModel(
      [...model.nodes, makeNode({ id: 'section:second', kind: 'section', parentId: 'root:prompt' })],
      [edge],
    );
    const measurements = { nodeHeights: new Map([[edge.source, 400]]) };
    const expanded = layoutGraph(rows, undefined, measurements);
    const collapsed = layoutGraph(rows, new Set([edge.source]), measurements);
    expect(expanded.get('section:second')!.y).toBe(440);
    expect(collapsed.get('section:second')!.y).toBe(LAYOUT_COLLAPSED_ROW_HEIGHT);
  });
  it('preserves label clearance when a source section is resized wider', () => {
    const labelWidth = 180;
    const nodeWidth = 560;
    const positions = layoutGraph(model, undefined, {
      nodeWidths: new Map([[edge.source, nodeWidth]]),
      edgeLabelWidths: new Map([[edge.id, labelWidth]]),
    });
    const gap = positions.get(edge.target)!.x - positions.get(edge.source)!.x - nodeWidth;
    expect(gap).toBeGreaterThanOrEqual(labelWidth + 2 * 16);
  });
});

describe('layoutGraph constants', () => {
  // Deliberately hardcoded, not imported from `FragmentNode` — the coupling
  // this test guards is: `FragmentNode`'s `fixedSize` layout is a fixed
  // 360x220 card (see `FragmentNode.tsx`/`FragmentNode.test.tsx`), and these
  // two layout constants must each clear the corresponding card dimension by
  // at least a 40px gutter, or fixed-size canvas cards overlap their
  // neighbours again (the defect this module fixes).
  const FIXED_CARD_WIDTH = 360;
  const FIXED_CARD_HEIGHT = 220;
  const GUTTER = 40;

  it('keeps LAYOUT_COLUMN_WIDTH large enough to clear a fixed-size card plus a gutter', () => {
    expect(LAYOUT_COLUMN_WIDTH).toBeGreaterThanOrEqual(FIXED_CARD_WIDTH + GUTTER);
  });

  it('keeps LAYOUT_ROW_HEIGHT large enough to clear a fixed-size card plus a gutter', () => {
    expect(LAYOUT_ROW_HEIGHT).toBeGreaterThanOrEqual(FIXED_CARD_HEIGHT + GUTTER);
  });

  it('keeps LAYOUT_COLLAPSED_ROW_HEIGHT large enough for the compact control row and a gutter', () => {
    expect(LAYOUT_COLLAPSED_ROW_HEIGHT).toBeGreaterThanOrEqual(LAYOUT_COLLAPSED_CARD_HEIGHT + GUTTER);
    expect(LAYOUT_COLLAPSED_ROW_HEIGHT).toBeLessThan(LAYOUT_ROW_HEIGHT);
  });
});

describe('layoutGraph', () => {
  it('is deterministic: identical input always yields identical output', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'section:mission', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'section:strategy', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'variable:name', kind: 'variable' }),
      makeNode({ id: 'tool:web_search', kind: 'tool' }),
    ]);

    const first = layoutGraph(model);
    const second = layoutGraph(model);

    expect(Array.from(second.entries())).toEqual(Array.from(first.entries()));
  });

  it('places the root node at depth 0 (column x = 0)', () => {
    const model = makeModel([makeNode({ id: 'root:scout', kind: 'root' })]);

    const positions = layoutGraph(model);

    expect(positions.get('root:scout')).toEqual({ x: 0, y: 0 });
  });

  it('assigns each section a column one step to the right of its parent, per parentId chain depth', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'section:parent', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'section:child', kind: 'section', parentId: 'section:parent' }),
      makeNode({ id: 'section:grandchild', kind: 'section', parentId: 'section:child' }),
    ]);

    const positions = layoutGraph(model);

    expect(positions.get('root:scout')?.x).toBe(0);
    expect(positions.get('section:parent')?.x).toBe(LAYOUT_COLUMN_WIDTH);
    expect(positions.get('section:child')?.x).toBe(2 * LAYOUT_COLUMN_WIDTH);
    expect(positions.get('section:grandchild')?.x).toBe(3 * LAYOUT_COLUMN_WIDTH);
  });

  it('stacks siblings within the same column vertically at a fixed spacing, in input order', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'section:first', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'section:second', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'section:third', kind: 'section', parentId: 'root:scout' }),
    ]);

    const positions = layoutGraph(model);

    const first = positions.get('section:first');
    const second = positions.get('section:second');
    const third = positions.get('section:third');

    expect(first?.x).toBe(second?.x);
    expect(second?.x).toBe(third?.x);
    expect(first?.y).toBe(0);
    expect(second?.y).toBe(LAYOUT_ROW_HEIGHT);
    expect(third?.y).toBe(2 * LAYOUT_ROW_HEIGHT);
  });

  // ── Collapse-aware compaction (`collapsedNodeIds`) ─────────────────────────

  it('compacts a column below a collapsed section to the collapsed slot height', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'section:first', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'section:second', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'section:third', kind: 'section', parentId: 'root:scout' }),
    ]);

    const positions = layoutGraph(model, new Set(['section:first']));

    expect(positions.get('section:first')?.y).toBe(0);
    expect(positions.get('section:second')?.y).toBe(LAYOUT_COLLAPSED_ROW_HEIGHT);
    expect(positions.get('section:third')?.y).toBe(LAYOUT_COLLAPSED_ROW_HEIGHT + LAYOUT_ROW_HEIGHT);
  });

  it('compacts every row when all sections in a column are collapsed', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'section:first', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'section:second', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'section:third', kind: 'section', parentId: 'root:scout' }),
    ]);

    const positions = layoutGraph(model, new Set(['section:first', 'section:second', 'section:third']));

    expect(positions.get('section:first')?.y).toBe(0);
    expect(positions.get('section:second')?.y).toBe(LAYOUT_COLLAPSED_ROW_HEIGHT);
    expect(positions.get('section:third')?.y).toBe(2 * LAYOUT_COLLAPSED_ROW_HEIGHT);
  });

  it('leaves other columns untouched when one column has a collapsed section', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'section:parent', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'section:child-a', kind: 'section', parentId: 'section:parent' }),
      makeNode({ id: 'section:child-b', kind: 'section', parentId: 'section:parent' }),
    ]);

    const positions = layoutGraph(model, new Set(['section:parent']));

    // Depth-2 column is unaffected by the depth-1 collapse.
    expect(positions.get('section:child-a')?.y).toBe(0);
    expect(positions.get('section:child-b')?.y).toBe(LAYOUT_ROW_HEIGHT);
  });

  it('ignores non-section ids in collapsedNodeIds (root, variable, tool)', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'root:closer', kind: 'root' }),
      makeNode({ id: 'section:mission', kind: 'section', parentId: 'root:closer' }),
      makeNode({ id: 'variable:name', kind: 'variable' }),
      makeNode({ id: 'tool:web_search', kind: 'tool' }),
    ]);

    const collapsedEverything = layoutGraph(model, new Set(['root:scout', 'variable:name', 'tool:web_search']));
    const collapsedNothing = layoutGraph(model);

    expect(Array.from(collapsedEverything.entries())).toEqual(Array.from(collapsedNothing.entries()));
  });

  it('produces the exact pre-collapse-awareness layout when collapsedNodeIds is omitted or empty', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'section:first', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'section:second', kind: 'section', parentId: 'root:scout' }),
    ]);

    const omitted = layoutGraph(model);
    const empty = layoutGraph(model, new Set());

    expect(Array.from(empty.entries())).toEqual(Array.from(omitted.entries()));
    expect(omitted.get('section:second')?.y).toBe(LAYOUT_ROW_HEIGHT);
  });

  it('places variable and tool nodes in one shared column to the right of the deepest section column', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'section:parent', kind: 'section', parentId: 'root:scout' }),
      makeNode({ id: 'section:child', kind: 'section', parentId: 'section:parent' }),
      makeNode({ id: 'variable:name', kind: 'variable' }),
      makeNode({ id: 'tool:web_search', kind: 'tool' }),
    ]);

    const positions = layoutGraph(model);

    // Deepest section column is `section:child` at depth 2 (x = 2 * width).
    const sharedColumnX = 3 * LAYOUT_COLUMN_WIDTH;
    expect(positions.get('variable:name')?.x).toBe(sharedColumnX);
    expect(positions.get('tool:web_search')?.x).toBe(sharedColumnX);
  });

  it('stacks variable/tool nodes in stable (input) order within their shared column', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'variable:first', kind: 'variable' }),
      makeNode({ id: 'tool:second', kind: 'tool' }),
      makeNode({ id: 'variable:third', kind: 'variable' }),
    ]);

    const positions = layoutGraph(model);

    expect(positions.get('variable:first')?.y).toBe(0);
    expect(positions.get('tool:second')?.y).toBe(LAYOUT_ROW_HEIGHT);
    expect(positions.get('variable:third')?.y).toBe(2 * LAYOUT_ROW_HEIGHT);
  });

  it('does not crash on an empty model and returns an empty map', () => {
    const model = makeModel([]);

    const positions = layoutGraph(model);

    expect(positions.size).toBe(0);
  });

  it('treats a node whose parentId is missing from the model as depth 0', () => {
    const model = makeModel([makeNode({ id: 'section:orphan', kind: 'section', parentId: 'section:does-not-exist' })]);

    const positions = layoutGraph(model);

    expect(positions.get('section:orphan')).toEqual({ x: 0, y: 0 });
  });

  it('shares a column with an unrelated root sibling once a dangling parentId is treated as depth 0', () => {
    const model = makeModel([
      makeNode({ id: 'root:scout', kind: 'root' }),
      makeNode({ id: 'section:orphan', kind: 'section', parentId: 'section:does-not-exist' }),
    ]);

    const positions = layoutGraph(model);

    expect(positions.get('root:scout')?.x).toBe(0);
    expect(positions.get('section:orphan')?.x).toBe(0);
    expect(positions.get('root:scout')?.y).toBe(0);
    expect(positions.get('section:orphan')?.y).toBe(LAYOUT_ROW_HEIGHT);
  });

  it('does not infinite-loop on a two-node parentId cycle, and resolves deterministically', () => {
    const model = makeModel([
      makeNode({ id: 'section:a', kind: 'section', parentId: 'section:b' }),
      makeNode({ id: 'section:b', kind: 'section', parentId: 'section:a' }),
    ]);

    const run = () => layoutGraph(model);

    expect(run).not.toThrow();
    const positions = run();
    expect(positions.size).toBe(2);
    // Both cycle members must land on defined, finite, non-negative columns.
    for (const id of ['section:a', 'section:b']) {
      const position = positions.get(id);
      expect(position).toBeDefined();
      expect(Number.isFinite(position?.x)).toBe(true);
      expect(Number.isFinite(position?.y)).toBe(true);
      expect(position?.x).toBeGreaterThanOrEqual(0);
    }
    // Re-running on the same model must not change the resolution.
    expect(Array.from(layoutGraph(model).entries())).toEqual(Array.from(positions.entries()));
  });

  it('does not infinite-loop on a self-referencing parentId', () => {
    const model = makeModel([makeNode({ id: 'section:self', kind: 'section', parentId: 'section:self' })]);

    const run = () => layoutGraph(model);

    expect(run).not.toThrow();
    expect(run().get('section:self')).toEqual({ x: 0, y: 0 });
  });
});

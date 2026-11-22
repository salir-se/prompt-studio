/**
 * A pure, deterministic layered/tree layout over a `PromptGraphModel`
 * (ADR-200). No React, no xyflow, no DOM — this module computes plain
 * `{ x, y }` positions only, so it can be exhaustively unit-tested without a
 * renderer and reused by any future graph-rendering integration.
 *
 * Layout rule: every `'root'`/`'section'` node is assigned a column equal to
 * its depth in the `parentId` chain (root at depth 0), and siblings within a
 * column are stacked vertically at a fixed spacing, in stable (input array)
 * order. `'variable'`/`'tool'` nodes never carry a `parentId` — per
 * `PromptGraphNode`'s doc they are shared across the whole tree, not owned by
 * any one section — so they are placed together in one dedicated column one
 * step to the right of the deepest root/section column, also stacked in
 * stable order.
 *
 * Deliberately no layout library (no dagre, no elk): the projection is small
 * and fully defined by `parentId`, so a hand-rolled column/row assignment is
 * simpler than pulling in a general-purpose graph layout dependency.
 */

import type { PromptGraphModel, PromptGraphNode } from '@prompt-studio/prompts';

export const EDGE_LABEL_NODE_GAP = 16;
export const SECTION_NODE_WIDTH = 360;
export const LABEL_NODE_WIDTH = 200;

export interface LayoutMeasurements {
  nodeWidths?: ReadonlyMap<string, number>;
  nodeHeights?: ReadonlyMap<string, number>;
  /** Rendered label background widths, measured in graph coordinates. */
  edgeLabelWidths?: ReadonlyMap<string, number>;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

/**
 * Horizontal spacing between adjacent depth columns, in canvas pixels.
 *
 * Invariant: must be >= the canvas card's fixed width (360px, `FragmentNode`'s
 * `fixedSize` layout — see `PromptGraphCanvas`'s section node type) plus a
 * gutter, so adjacent columns of fixed-size cards never overlap. This
 * constant and `FragmentNode`'s fixed dimensions must move together — bumping
 * one without the other reintroduces card overlap.
 */
export const LAYOUT_COLUMN_WIDTH = 420;

/**
 * Vertical spacing between stacked siblings within one column, in canvas pixels.
 *
 * Invariant: must be >= the canvas card's fixed height (220px, `FragmentNode`'s
 * `fixedSize` layout) plus a gutter, so stacked siblings in the same column
 * never overlap vertically. This constant and `FragmentNode`'s fixed
 * dimensions must move together — bumping one without the other reintroduces
 * card overlap.
 */
export const LAYOUT_ROW_HEIGHT = 260;

/** One collapsed control row; keep xyflow bounds and the sibling slot in sync. */
export const LAYOUT_COLLAPSED_CARD_HEIGHT = 56;
export const LAYOUT_COLLAPSED_ROW_HEIGHT = LAYOUT_COLLAPSED_CARD_HEIGHT + 40;

/**
 * `variable`/`tool` nodes are laid out by kind alone, regardless of whether a
 * (contract-violating) input happens to set a `parentId` on one — see the
 * module doc. Everything else (`'root'`/`'section'`) is laid out by walking
 * its `parentId` chain.
 */
function isSharedColumnKind(kind: PromptGraphNode['kind']): boolean {
  return kind === 'variable' || kind === 'tool' || kind === 'file';
}

/**
 * Depth of `nodeId` in its `parentId` chain, memoized and defensive against
 * two malformed-input cases the caller cannot rule out ahead of time:
 *
 *  - a dangling `parentId` (references a node absent from the model) — the
 *    referencing node is treated as a root (depth 0);
 *  - a `parentId` cycle — resolved deterministically without recursing
 *    forever by breaking at the first node revisited on the current chain
 *    (that node becomes the cycle's depth-0 anchor; the rest of the cycle is
 *    depth-numbered relative to it). `visiting` tracks only the chain of the
 *    current top-level call, so a node already memoized from an earlier call
 *    short-circuits before any cycle check.
 */
function computeDepth(
  nodeId: string,
  nodesById: ReadonlyMap<string, PromptGraphNode>,
  memo: Map<string, number>,
  visiting: Set<string>,
): number {
  const cached = memo.get(nodeId);
  if (cached !== undefined) {
    return cached;
  }

  const node = nodesById.get(nodeId);
  if (!node || node.parentId === undefined) {
    memo.set(nodeId, 0);
    return 0;
  }

  if (visiting.has(nodeId)) {
    // Cycle: this node was already on the current chain. Anchor it at depth 0
    // instead of recursing again — the frame that set this in motion unwinds
    // and (see below) will not overwrite this resolution.
    memo.set(nodeId, 0);
    return 0;
  }

  const parent = nodesById.get(node.parentId);
  if (!parent) {
    memo.set(nodeId, 0);
    return 0;
  }

  visiting.add(nodeId);
  const parentDepth = computeDepth(node.parentId, nodesById, memo, visiting);
  visiting.delete(nodeId);

  // A nested call may already have memoized `nodeId` while resolving a cycle
  // that loops back through it (see the branch above) — never overwrite that.
  if (!memo.has(nodeId)) {
    memo.set(nodeId, parentDepth + 1);
  }
  return memo.get(nodeId) as number;
}

/**
 * Computes a deterministic `{ x, y }` position for every node in `model`.
 * Pure: calling this twice on the same (or a deeply-equal) model and the same
 * `collapsedNodeIds` produces deeply-equal output, since every position is
 * derived only from those inputs and stable input order — never from Set/Map
 * iteration order keyed by anything other than that.
 *
 * `collapsedNodeIds` (optional) compacts the layout around collapsed cards:
 * a `'section'` node in the set consumes a `LAYOUT_COLLAPSED_ROW_HEIGHT` slot
 * instead of a full `LAYOUT_ROW_HEIGHT` one, pulling every node below it in
 * the same column up accordingly. Only `'section'` nodes honour the set —
 * `'root'` nodes cannot collapse, and the shared `'variable'`/`'tool'` column
 * has no collapsed form — so ids of other kinds in the set are ignored.
 * Omitted (or empty), every slot is full-height and the output is identical
 * to what this function produced before collapse-awareness existed.
 */
export function layoutGraph(
  model: PromptGraphModel,
  collapsedNodeIds?: ReadonlySet<string>,
  measurements: LayoutMeasurements = {},
): Map<string, LayoutPosition> {
  const positions = new Map<string, LayoutPosition>();
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));

  const depthColumnNodes: PromptGraphNode[] = [];
  const sharedColumnNodes: PromptGraphNode[] = [];
  for (const node of model.nodes) {
    if (isSharedColumnKind(node.kind)) {
      sharedColumnNodes.push(node);
    } else {
      depthColumnNodes.push(node);
    }
  }

  const depthMemo = new Map<string, number>();
  const depthByNodeId = new Map<string, number>();
  let maxDepth = 0;
  for (const node of depthColumnNodes) {
    const depth = computeDepth(node.id, nodesById, depthMemo, new Set());
    depthByNodeId.set(node.id, depth);
    if (depth > maxDepth) {
      maxDepth = depth;
    }
  }

  const widthByColumn = new Map<number, number>();
  for (const node of depthColumnNodes) {
    const column = depthByNodeId.get(node.id) ?? 0;
    const width =
      measurements.nodeWidths?.get(node.id) ?? (node.kind === 'section' ? SECTION_NODE_WIDTH : LABEL_NODE_WIDTH);
    widthByColumn.set(column, Math.max(widthByColumn.get(column) ?? 0, width));
  }
  const xByColumn = new Map<number, number>([[0, 0]]);
  for (let column = 1; column <= maxDepth; column++) {
    xByColumn.set(
      column,
      (xByColumn.get(column - 1) ?? 0) + Math.max(LAYOUT_COLUMN_WIDTH, (widthByColumn.get(column - 1) ?? 0) + 60),
    );
  }
  const labelWidth = Math.max(0, ...model.edges.map((edge) => measurements.edgeLabelWidths?.get(edge.id) ?? 0));
  const sharedColumnX = depthColumnNodes.length
    ? (xByColumn.get(maxDepth) ?? 0) +
      Math.max(
        LAYOUT_COLUMN_WIDTH,
        (widthByColumn.get(maxDepth) ?? 0) + Math.max(60, Math.ceil(labelWidth) + 2 * EDGE_LABEL_NODE_GAP),
      )
    : 0;

  // Per-column running y offset (not a row index): each placed node advances its
  // column's offset by the slot IT consumes, so a collapsed section compacts
  // everything stacked below it in that column — see `collapsedNodeIds`'s doc.
  const yOffsetByColumn = new Map<number, number>();
  for (const node of depthColumnNodes) {
    const depth = depthByNodeId.get(node.id) ?? 0;
    const y = yOffsetByColumn.get(depth) ?? 0;
    const slotHeight =
      node.kind === 'section' && collapsedNodeIds?.has(node.id)
        ? LAYOUT_COLLAPSED_ROW_HEIGHT
        : Math.max(LAYOUT_ROW_HEIGHT, (measurements.nodeHeights?.get(node.id) ?? 0) + 40);
    yOffsetByColumn.set(depth, y + slotHeight);
    positions.set(node.id, { x: xByColumn.get(depth) ?? 0, y });
  }

  sharedColumnNodes.forEach((node, index) => {
    positions.set(node.id, { x: sharedColumnX, y: index * LAYOUT_ROW_HEIGHT });
  });

  return positions;
}

/** Reference labels share the empty gutter before the variable/tool/file column. */
export function referenceLabelCenter(
  model: PromptGraphModel,
  positions: ReadonlyMap<string, LayoutPosition>,
  nodeWidths?: ReadonlyMap<string, number>,
): number | undefined {
  const shared = model.nodes.filter((node) => isSharedColumnKind(node.kind));
  const sections = model.nodes.filter((node) => !isSharedColumnKind(node.kind));
  if (!shared.length || !sections.length) return undefined;
  const left = Math.max(
    ...sections.map(
      (node) =>
        (positions.get(node.id)?.x ?? 0) +
        (nodeWidths?.get(node.id) ?? (node.kind === 'section' ? SECTION_NODE_WIDTH : LABEL_NODE_WIDTH)),
    ),
  );
  const right = Math.min(...shared.map((node) => positions.get(node.id)?.x ?? 0));
  return (left + right) / 2;
}

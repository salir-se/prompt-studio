/**
 * A pure, deterministic computation of the ancestor path from a selected
 * `PromptGraphModel` node back to the root(s) it descends from (ADR-200). No
 * React, no xyflow, no DOM — this module returns plain id sets only, so it
 * can be exhaustively unit-tested without a renderer and reused by any future
 * selection-highlighting integration (the canvas consuming this is a separate
 * task).
 *
 * Path rule for a `'root'`/`'section'` node: walk the `parentId` chain up to
 * the root, including every traversed node id and, for each parent → child
 * hop, the connecting `'contains'` edge.
 *
 * Path rule for a `'variable'`/`'tool'` node: per `PromptGraphNode`'s doc,
 * these are shared and deliberately carry no `parentId` — there is no
 * ancestor chain of their own to walk. Instead the path is every inbound
 * `'declares'` edge (the sections that reference this binding) plus each
 * declaring section's own ancestor chain to the root — "which sections use
 * this variable/tool, and where they sit in the structure" is the most
 * useful reading of "path to root" for a node that has many parents rather
 * than one.
 */

import type { PromptGraphEdge, PromptGraphModel, PromptGraphNode } from '@prompt-studio/prompts';

export interface SelectionPath {
  /** Every node id on the path, INCLUDING the selected node itself and the root(s) reached. */
  nodeIds: ReadonlySet<string>;
  /** Every edge id on the path. */
  edgeIds: ReadonlySet<string>;
}

function isSharedNodeKind(kind: PromptGraphNode['kind']): boolean {
  return kind === 'variable' || kind === 'tool' || kind === 'file';
}

/**
 * Walks `startNodeId`'s `parentId` chain up to the root, adding every
 * traversed node id to `nodeIds` and, for each hop, the connecting
 * `'contains'` edge (when one exists) to `edgeIds`. Mutates both sets
 * in place so a variable/tool caller can fold multiple declaring sections'
 * chains into one accumulator with automatic dedup.
 *
 * Defensive against the same two malformed-input cases `layout.ts`'s
 * `computeDepth` guards against, mirroring its handling exactly:
 *
 *  - a dangling `parentId` (references a node absent from the model) ends
 *    the walk at the last real node — the dangling id itself is never added;
 *  - a `parentId` cycle terminates deterministically by stopping as soon as
 *    a node already visited on THIS walk is encountered again, rather than
 *    recursing/looping forever.
 */
function walkAncestryInto(
  startNodeId: string,
  nodesById: ReadonlyMap<string, PromptGraphNode>,
  containsEdgeByParentChild: ReadonlyMap<string, PromptGraphEdge>,
  nodeIds: Set<string>,
  edgeIds: Set<string>,
): void {
  const visitedThisWalk = new Set<string>();
  let currentId: string | undefined = startNodeId;

  while (currentId !== undefined) {
    if (visitedThisWalk.has(currentId)) {
      // Cycle: this node is already on the current chain — stop instead of
      // looping forever. It (and its edges) were already added below.
      break;
    }
    visitedThisWalk.add(currentId);
    nodeIds.add(currentId);

    const node = nodesById.get(currentId);
    if (!node || node.parentId === undefined) {
      break;
    }
    if (!nodesById.has(node.parentId)) {
      // Dangling parentId (malformed input) — end the walk at the last real
      // node rather than adding a node id the model doesn't actually have.
      break;
    }

    const edge = containsEdgeByParentChild.get(`${node.parentId}\u0000${currentId}`);
    if (edge) {
      edgeIds.add(edge.id);
    }

    currentId = node.parentId;
  }
}

/**
 * Computes the highlight set for a selected node: every node id and edge id
 * on its path back to the root(s). Pure — calling this twice on the same (or
 * a deeply-equal) model and id produces deeply-equal output.
 *
 * `undefined`, or an id absent from `model`, always yields empty sets; this
 * function never throws.
 */
export function selectionPath(model: PromptGraphModel, selectedNodeId: string | undefined): SelectionPath {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  if (selectedNodeId === undefined) {
    return { nodeIds, edgeIds };
  }

  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const selectedNode = nodesById.get(selectedNodeId);
  if (!selectedNode) {
    return { nodeIds, edgeIds };
  }

  const containsEdgeByParentChild = new Map<string, PromptGraphEdge>();
  const declaresEdgesByTarget = new Map<string, PromptGraphEdge[]>();
  for (const edge of model.edges) {
    if (edge.kind === 'contains') {
      containsEdgeByParentChild.set(`${edge.source}\u0000${edge.target}`, edge);
    } else if (edge.kind === 'declares' || edge.kind === 'references') {
      const existing = declaresEdgesByTarget.get(edge.target);
      if (existing) {
        existing.push(edge);
      } else {
        declaresEdgesByTarget.set(edge.target, [edge]);
      }
    }
  }

  if (isSharedNodeKind(selectedNode.kind)) {
    nodeIds.add(selectedNodeId);
    const declaringEdges = declaresEdgesByTarget.get(selectedNodeId) ?? [];
    for (const edge of declaringEdges) {
      edgeIds.add(edge.id);
      walkAncestryInto(edge.source, nodesById, containsEdgeByParentChild, nodeIds, edgeIds);
    }
    return { nodeIds, edgeIds };
  }

  walkAncestryInto(selectedNodeId, nodesById, containsEdgeByParentChild, nodeIds, edgeIds);
  return { nodeIds, edgeIds };
}

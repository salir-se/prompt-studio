import { extractPromptFileReferences } from '../prompt-file-references';
import { maskPromptSourceLiterals } from '../prompt-source-literals';
/**
 * Pure projection of a parsed `PromptTree` into the flat `PromptGraphModel`
 * shape defined in `./types` (ADR-200). See that file's module doc for why
 * the two models are kept distinct and why this module must never import
 * React, the DOM lib, or a graph-rendering package.
 *
 * This module is deliberately independent of `parse-tree.ts` (the parser):
 * it only consumes the frozen `PromptTree` contract, never the parser's
 * implementation, so the two can be built, tested, and reviewed in parallel.
 */
import type {
  PromptGraphEdge,
  PromptGraphEdgeKind,
  PromptGraphModel,
  PromptGraphNode,
  PromptTree,
  PromptTreeNode,
} from './types';

// ── Id derivation ────────────────────────────────────────────────────────────
//
// Every id below is a deterministic function of the input, never a counter or
// a random value — see `PromptTreeNode.id`'s doc for why: a future diff view
// or "link to this node" URL needs identity to survive edits to unrelated
// parts of the tree, which an incrementing index would not survive.
//
// Every id is also prefixed by its `PromptGraphNodeKind`. Sections carry their
// own already-stable `PromptTreeNode.id`, but variable/tool names come from a
// completely different namespace (bare `{{name}}`/tool-word text) — nothing
// stops a section's id and a variable's name from being the literal same
// string (e.g. both "foo"). The kind prefix is what actually guarantees
// uniqueness across kinds; deriving from source alone is not enough.

const rootNodeId = (key: string): string => `root:${key}`;
const sectionNodeId = (node: PromptTreeNode): string => `section:${node.id}`;
const variableNodeId = (name: string): string => `variable:${name}`;
const toolNodeId = (name: string): string => `tool:${name}`;

/**
 * Edge ids are derived from `kind` plus both endpoints (not a counter)
 * because that is exactly the tuple that identifies "this relationship"
 * uniquely: a `'contains'` edge is 1:1 with a (parent section, child
 * section) pair, and a `'declares'` edge is 1:1 with a (section, shared
 * variable-or-tool node) pair once occurrences are deduplicated — see the
 * dedup note on `collectUniqueNames` below.
 */
const edgeId = (kind: PromptGraphEdgeKind, source: string, target: string): string => `${kind}:${source}->${target}`;

/**
 * A section's own `variables`/`toolMentions` arrays record raw occurrences,
 * not a deduplicated set — the same `{{name}}` could plausibly appear twice
 * in one section's body text. Projection rule 4/5 says one shared node per
 * distinct name across the WHOLE tree, with one edge per (section, name)
 * pair — so within a single section's own list we must also collapse
 * repeats, otherwise two occurrences of the same name in one section would
 * produce two edges sharing the same derived id (a uniqueness violation).
 */
function collectUniqueNames(names: readonly string[]): string[] {
  return [...new Set(names)];
}

/**
 * Projects a `PromptTree` into its flat `PromptGraphModel`. Pure and
 * deterministic: calling this twice on the same (or a deeply-equal) tree
 * produces deeply-equal output, since every id is derived from the input
 * and traversal order is fixed (depth-first, pre-order, matching source
 * order) rather than dependent on iteration/insertion order of any Set/Map
 * keyed by anything other than first-seen name.
 */
export function toGraphModel(tree: PromptTree): PromptGraphModel {
  const nodes: PromptGraphNode[] = [];
  const edges: PromptGraphEdge[] = [];

  const rootId = rootNodeId(tree.key);
  nodes.push({ id: rootId, kind: 'root', label: tree.key, data: { kind: 'root', tree } });
  const maskedSource = maskPromptSourceLiterals(tree.text);

  // Variable/tool nodes are shared across the whole tree (rule 4/5), so they
  // are created lazily, the first time any section mentions that name — the
  // map both dedupes and remembers the id to link subsequent `declares`
  // edges back to the same node.
  const variableIdsByName = new Map<string, string>();
  const toolIdsByName = new Map<string, string>();

  function ensureVariableNode(name: string): string {
    const existing = variableIdsByName.get(name);
    if (existing !== undefined) return existing;
    const id = variableNodeId(name);
    variableIdsByName.set(name, id);
    // Variable/tool nodes have no `parentId` — rule 6: they are shared, not
    // owned by any one section.
    nodes.push({ id, kind: 'variable', label: name, data: { kind: 'variable', name } });
    return id;
  }

  function ensureToolNode(name: string): string {
    const existing = toolIdsByName.get(name);
    if (existing !== undefined) return existing;
    const id = toolNodeId(name);
    toolIdsByName.set(name, id);
    nodes.push({ id, kind: 'tool', label: name, data: { kind: 'tool', name } });
    return id;
  }

  function addFileReferences(text: string, source: string): void {
    for (const reference of extractPromptFileReferences(text)) {
      const target = `file:${reference.path}`;
      const existing = nodes.find((node) => node.id === target);
      if (existing?.data.kind === 'file') existing.data.loadBeforeBody ||= reference.loadBeforeBody;
      else nodes.push({ id: target, kind: 'file', label: reference.path, data: { kind: 'file', ...reference } });
      const id = edgeId('references', source, target);
      const existingEdge = edges.find((edge) => edge.id === id);
      if (existingEdge) {
        if (reference.loadBeforeBody) existingEdge.label = 'Load before prompt';
        continue;
      }
      edges.push({
        id,
        source,
        target,
        kind: 'references',
        label: reference.loadBeforeBody ? 'Load before prompt' : 'File reference',
      });
    }
  }

  function visitSection(node: PromptTreeNode, parentId: string): void {
    const id = sectionNodeId(node);
    nodes.push({ id, kind: 'section', label: node.title, parentId, data: { kind: 'section', node } });
    edges.push({ id: edgeId('contains', parentId, id), source: parentId, target: id, kind: 'contains' });

    for (const name of collectUniqueNames(node.variables)) {
      const variableId = ensureVariableNode(name);
      // `{{name}}` (braces included) is the label — see `PromptGraphEdge.label`'s
      // doc for why: it matches prompt source syntax and the canvas's
      // violet-chip vocabulary, rather than the bare name a tool edge uses.
      edges.push({
        id: edgeId('declares', id, variableId),
        source: id,
        target: variableId,
        kind: 'declares',
        label: `{{${name}}}`,
      });
    }
    for (const name of collectUniqueNames(node.toolMentions)) {
      const toolId = ensureToolNode(name);
      edges.push({
        id: edgeId('declares', id, toolId),
        source: id,
        target: toolId,
        kind: 'declares',
        label: name,
      });
    }

    addFileReferences(node.text, id);

    // Depth-first, pre-order (rule 2): this section's own node/edges are
    // already pushed above, so recursing here visits children before the
    // next sibling, matching source order.
    for (const child of node.children) {
      visitSection(child, id);
    }
    // XML parents can resume their own prose after a child closes.
    for (let index = 0; index < node.children.length; index++) {
      addFileReferences(
        maskedSource.slice(node.children[index].range.end, node.children[index + 1]?.range.start ?? node.range.end),
        id,
      );
    }
  }

  for (const topLevel of tree.children) {
    visitSection(topLevel, rootId);
  }

  // Unscoped source includes preamble, gaps between XML sections and trailing prose.
  let cursor = 0;
  for (const section of tree.children) {
    addFileReferences(maskedSource.slice(cursor, section.range.start), rootId);
    cursor = section.range.end;
  }
  addFileReferences(maskedSource.slice(cursor), rootId);
  return { nodes, edges };
}

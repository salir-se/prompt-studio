import type { PromptTree, PromptTreeNode } from './types';

export interface CanonicalSectionProjection {
  readonly tag: string;
  readonly heading: string;
}

/**
 * Coalesces ADR-200's human heading + stable XML tag pair into the one section
 * node ADR-202 projects in the editor. Incidental caps labels inside a tagged
 * section remain part of its editable body instead of becoming extra cards.
 */
export function projectCanonicalPromptTree(
  tree: PromptTree,
  sections: readonly CanonicalSectionProjection[],
): PromptTree {
  const headings = new Map(sections.map((section) => [section.tag, section.heading]));
  const xmlNodes: PromptTreeNode[] = [];
  const rawParent = new Map<PromptTreeNode, PromptTreeNode | null>();

  const collect = (nodes: readonly PromptTreeNode[], parent: PromptTreeNode | null): void => {
    for (const node of nodes) {
      rawParent.set(node, parent);
      if (node.delimiter === 'xml-tag') xmlNodes.push(node);
      collect(node.children, node);
    }
  };
  collect(tree.children, null);

  const projectedByRaw = new Map<PromptTreeNode, PromptTreeNode>();
  for (const raw of xmlNodes) {
    const parent = rawParent.get(raw);
    const pairedHeading =
      headings.has(raw.tag ?? '') &&
      parent?.delimiter === 'atx-heading' &&
      parent.text.trim() === '' &&
      parent.children[0] === raw
        ? parent
        : null;
    projectedByRaw.set(raw, {
      ...raw,
      title: headings.get(raw.tag ?? '') ?? raw.title,
      range: { start: pairedHeading?.range.start ?? raw.range.start, end: raw.range.end },
      children: [],
    });
  }

  const roots: PromptTreeNode[] = [];
  for (const raw of xmlNodes) {
    const projected = projectedByRaw.get(raw) as PromptTreeNode;
    let ancestor = rawParent.get(raw) ?? null;
    while (ancestor && ancestor.delimiter !== 'xml-tag') ancestor = rawParent.get(ancestor) ?? null;
    const parent = ancestor ? projectedByRaw.get(ancestor) : undefined;
    if (parent) parent.children.push(projected);
    else roots.push(projected);
  }

  const containsXmlSection = (node: PromptTreeNode): boolean =>
    node.delimiter === 'xml-tag' || node.children.some(containsXmlSection);
  const cloneStandaloneSection = (node: PromptTreeNode, depth: number): PromptTreeNode => ({
    ...node,
    depth,
    children: node.children.map((child) => cloneStandaloneSection(child, depth + 1)),
  });
  roots.push(
    ...tree.children
      .filter((node) => node.delimiter === 'atx-heading' && !containsXmlSection(node))
      .map((node) => cloneStandaloneSection(node, 1)),
  );
  roots.sort((left, right) => left.range.start - right.range.start);

  const hydrate = (node: PromptTreeNode, depth: number): void => {
    node.depth = depth;
    node.children.sort((left, right) => left.range.start - right.range.start);
    if (node.delimiter !== 'xml-tag') {
      for (const child of node.children) hydrate(child, depth + 1);
      return;
    }
    const openingLineEnd = tree.text.indexOf('\n', tree.text.indexOf(`<${node.tag}>`, node.range.start));
    const contentStart = openingLineEnd === -1 ? node.range.start : openingLineEnd + 1;
    const contentEnd = node.children[0]?.range.start ?? node.range.end;
    node.text = tree.text.slice(contentStart, contentEnd);

    const variables = new Set<string>();
    const tools = new Set<string>();
    const gather = (rawNodes: readonly PromptTreeNode[]): void => {
      for (const raw of rawNodes) {
        if (raw.range.start >= contentEnd || raw.range.end <= contentStart) continue;
        for (const name of raw.variables) variables.add(name);
        for (const name of raw.toolMentions) tools.add(name);
        gather(raw.children);
      }
    };
    gather(tree.children);
    node.variables = [...variables];
    node.toolMentions = [...tools];
    for (const child of node.children) hydrate(child, depth + 1);
  };
  for (const root of roots) hydrate(root, 1);

  let maxDepth = 0;
  const measure = (nodes: readonly PromptTreeNode[]): void => {
    for (const node of nodes) {
      maxDepth = Math.max(maxDepth, node.depth);
      measure(node.children);
    }
  };
  measure(roots);
  return { ...tree, children: roots, maxDepth };
}

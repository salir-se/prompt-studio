import type { PromptTreeNode } from '@prompt-studio/prompts';

export const OUTLINE_ROOT = ':prompt-outline-root';

export interface OutlineItem {
  node?: PromptTreeNode;
  children: string[];
  path: string[];
  position: number;
  size: number;
}

/** Source metadata for the library loader and the selected section's actions. */
export function outlineModel(sections: readonly PromptTreeNode[]) {
  const items = new Map<string, OutlineItem>();
  function visit(nodes: readonly PromptTreeNode[], ancestors: string[]) {
    nodes.forEach((node, index) => {
      const path = [node.id, ...ancestors];
      items.set(node.id, {
        node,
        children: node.children.map((child) => child.id),
        path,
        position: index + 1,
        size: nodes.length,
      });
      visit(node.children, path);
    });
  }
  visit(sections, []);
  const root: OutlineItem = { children: sections.map((node) => node.id), path: [], position: 0, size: 0 };
  items.set(OUTLINE_ROOT, root);
  return { items, root };
}

/** Hidden selection may remain the Actions target; keyboard focus must stay visible. */
export function visibleOutlineFocus(
  model: ReturnType<typeof outlineModel>,
  path: readonly string[],
  expanded: ReadonlySet<string>,
) {
  return (
    path.find((id) =>
      model.items
        .get(id)
        ?.path.slice(1)
        .every((ancestor) => expanded.has(ancestor)),
    ) ??
    model.root.children[0] ??
    null
  );
}
